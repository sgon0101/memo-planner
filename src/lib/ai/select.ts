/**
 * 임베딩 기반 대표 메모 선별 — AI 분석(관심사/갭) 입력용
 *
 * 배경: "최근 20개"만 쓰면 오래된 관심사가 누락되고, 개수를 그냥 늘리면
 * 비용·지연·lost-in-the-middle·최근성 희석 문제가 생긴다.
 * 대신 이미 깔려 있는 pgvector 임베딩을 활용해:
 *
 *   1) 최근 메모 RECENT_N개 — 최근성 신호 (기존과 동일)
 *   2) 나머지 전체 이력을 k-means로 주제 클러스터링 →
 *      클러스터별 중심에 가장 가까운 메모 1개를 "대표"로 선발
 *
 * 이렇게 하면 프롬프트는 35개 수준으로 유지하면서 전체 이력의 주제 분포를
 * 커버한다. 대표 메모에는 클러스터 크기(유사 메모 N개 대표)를 함께 전달해
 * 모델이 빈도 감각을 갖도록 한다.
 *
 * fail-open: 임베딩이 부족하거나(초기 사용자·backfill 미완) 오류가 나면
 * mode:'recent-only'로 기존 동작(최근 메모만)으로 자연 강등된다.
 *
 * 결정성: k-means 초기 중심을 시간순 균등 간격으로 뽑아 Math.random 없이
 * 재현 가능한 결과를 만든다 (같은 데이터 → 같은 대표 선발).
 */

import type { SupabaseClient } from '@supabase/supabase-js'

const RECENT_N = 20          // 최근성 신호로 항상 포함할 최신 메모 수
const REP_N_MAX = 15         // 이력 대표 메모 최대 수 (= k-means k 상한)
const MIN_POOL = 15          // 이 미만이면 클러스터링 생략 (recent-only)
const POOL_CAP = 2000        // 임베딩 fetch 상한 — 페이로드 폭주 방지
const KMEANS_ITERS = 6

export interface SelectedMemo {
  id: string
  title: string
  content_text: string | null
  tags: string[] | null
  /** 이 메모가 대표하는 유사 메모 수 (클러스터 크기). 최근 메모는 undefined */
  clusterSize?: number
}

export interface MemoSelection {
  recent: SelectedMemo[]
  representative: SelectedMemo[]
  /** 잠금·삭제 제외 전체 메모 수 (분석이 커버하는 모수) */
  totalMemos: number
  mode: 'diverse' | 'recent-only'
}

/** pgvector 값 파싱 — supabase-js는 vector를 "[0.1,0.2,...]" 문자열로 반환 */
function parseEmbedding(v: unknown): Float64Array | null {
  try {
    if (Array.isArray(v)) return Float64Array.from(v as number[])
    if (typeof v === 'string') {
      const arr = JSON.parse(v) as number[]
      if (Array.isArray(arr) && arr.length > 0) return Float64Array.from(arr)
    }
  } catch { /* fallthrough */ }
  return null
}

/** L2 정규화 (in-place) — 이후 dot = cosine */
function normalize(v: Float64Array): Float64Array {
  let s = 0
  for (let i = 0; i < v.length; i++) s += v[i] * v[i]
  const n = Math.sqrt(s)
  if (n > 0) for (let i = 0; i < v.length; i++) v[i] /= n
  return v
}

function dot(a: Float64Array, b: Float64Array): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

interface PoolItem { id: string; vec: Float64Array }

/**
 * 결정적 k-means (cosine) — 초기 중심은 시간 정렬 풀에서 균등 간격 추출.
 * 반환: 클러스터별 { 대표 인덱스(중심 최근접), 크기 }, 크기 내림차순.
 */
function kmeansRepresentatives(pool: PoolItem[], k: number): { index: number; size: number }[] {
  const n = pool.length
  const dims = pool[0].vec.length

  // 초기 중심: 균등 간격 샘플 (결정적)
  let centroids: Float64Array[] = []
  for (let c = 0; c < k; c++) {
    const idx = Math.floor((c * n) / k)
    centroids.push(Float64Array.from(pool[idx].vec))
  }

  const assign = new Int32Array(n)
  for (let iter = 0; iter < KMEANS_ITERS; iter++) {
    // 할당
    for (let i = 0; i < n; i++) {
      let best = 0
      let bestSim = -Infinity
      for (let c = 0; c < k; c++) {
        const sim = dot(pool[i].vec, centroids[c])
        if (sim > bestSim) { bestSim = sim; best = c }
      }
      assign[i] = best
    }
    // 갱신
    const sums = Array.from({ length: k }, () => new Float64Array(dims))
    const counts = new Int32Array(k)
    for (let i = 0; i < n; i++) {
      const c = assign[i]
      counts[c]++
      const v = pool[i].vec
      const s = sums[c]
      for (let d = 0; d < dims; d++) s[d] += v[d]
    }
    centroids = centroids.map((old, c) => (counts[c] === 0 ? old : normalize(sums[c])))
  }

  // 클러스터별 중심 최근접 멤버 = 대표
  const reps: { index: number; size: number }[] = []
  for (let c = 0; c < k; c++) {
    let bestIdx = -1
    let bestSim = -Infinity
    let size = 0
    for (let i = 0; i < n; i++) {
      if (assign[i] !== c) continue
      size++
      const sim = dot(pool[i].vec, centroids[c])
      if (sim > bestSim) { bestSim = sim; bestIdx = i }
    }
    if (bestIdx >= 0) reps.push({ index: bestIdx, size })
  }
  return reps.sort((a, b) => b.size - a.size)
}

/**
 * AI 분석용 메모 선별: 최근 RECENT_N개 + 이력 클러스터 대표 REP_N_MAX개.
 * 어떤 실패든 recent-only로 강등 — 분석 자체를 막지 않는다.
 */
export async function selectMemosForAnalysis(
  supabase: SupabaseClient,
  userId: string,
): Promise<MemoSelection> {
  // 1) 최근 메모 (기존 동작과 동일 기준)
  const { data: recentRows } = await supabase
    .from('memos')
    .select('id, title, content_text, tags')
    .eq('user_id', userId)
    .eq('is_deleted', false)
    .eq('is_locked', false)
    .order('updated_at', { ascending: false })
    .limit(RECENT_N)

  const recent: SelectedMemo[] = recentRows ?? []
  const recentIds = new Set(recent.map((m) => m.id))

  // 전체 모수 (범위 문구 표시용)
  const { count: totalMemos } = await supabase
    .from('memos')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('is_deleted', false)
    .eq('is_locked', false)

  const fallback: MemoSelection = {
    recent,
    representative: [],
    totalMemos: totalMemos ?? recent.length,
    mode: 'recent-only',
  }
  if (recent.length === 0) return fallback

  try {
    // 2) 이력 임베딩 풀 (최근 메모 제외는 파싱 후 수행)
    const { data: embRows, error: embErr } = await supabase
      .from('memos')
      .select('id, embedding')
      .eq('user_id', userId)
      .eq('is_deleted', false)
      .eq('is_locked', false)
      .not('embedding', 'is', null)
      .order('updated_at', { ascending: true }) // 시간순 — 결정적 초기 중심용
      .limit(POOL_CAP)
    if (embErr || !embRows) return fallback

    const pool: PoolItem[] = []
    for (const row of embRows) {
      if (recentIds.has(row.id)) continue
      const vec = parseEmbedding(row.embedding)
      if (vec) pool.push({ id: row.id, vec: normalize(vec) })
    }
    if (pool.length < MIN_POOL) return fallback

    // 3) 클러스터링 → 대표 선발
    const k = Math.min(REP_N_MAX, Math.max(3, Math.floor(pool.length / 5)))
    const reps = kmeansRepresentatives(pool, k)
    const repIds = reps.map((r) => pool[r.index].id)
    const sizeById = new Map(reps.map((r) => [pool[r.index].id, r.size]))

    // 4) 대표 메모 본문 조회
    const { data: repRows, error: repErr } = await supabase
      .from('memos')
      .select('id, title, content_text, tags')
      .in('id', repIds)
    if (repErr || !repRows) return fallback

    const order = new Map(repIds.map((id, i) => [id, i]))
    const representative: SelectedMemo[] = repRows
      .slice()
      .sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99))
      .map((r) => ({ ...r, clusterSize: sizeById.get(r.id) }))

    return {
      recent,
      representative,
      totalMemos: totalMemos ?? recent.length + pool.length,
      mode: 'diverse',
    }
  } catch (e) {
    console.warn('[ai/select] diverse selection failed — recent-only fallback:', e instanceof Error ? e.message : e)
    return fallback
  }
}
