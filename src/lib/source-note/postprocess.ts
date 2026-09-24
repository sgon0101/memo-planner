/**
 * 소스 노트 서버 후처리 (4-1 어휘 목록, 4-4 정규화·이웃 추천) — 서버 전용
 *
 * 프롬프트를 믿지 않는다: 모델이 "existing"이라 해도 실제 어휘에 없으면 new로,
 * 띄어쓴 표기·불가 문자·중복은 서버에서 교정한다.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { buildCanonicalMap, resolveToCanonical, tagKey, wikiKey } from '@/lib/wiki/normalize'
import { embedText } from '@/lib/ai/embeddings'
import type { NoteSuggestion, RelatedMemoRef, SourceNoteAnalysis } from './types'

const VOCAB_WIKI_LIMIT = 300
const VOCAB_TAG_LIMIT = 150
const MAX_NEW_WIKIS = 3
const NEIGHBOR_COUNT = 5
/** related 라우트 기본 임계값과 동일 */
const NEIGHBOR_THRESHOLD = 0.4
const MAX_NEIGHBOR_SUGGESTIONS = 5
const PAGE = 1000

export interface Vocab {
  wikiCanonical: Map<string, string>
  tagCanonical: Map<string, string>
  /** 프롬프트용 "행동경제학(12)" 목록 */
  wikiList: string[]
  tagList: string[]
}

/** 사용자 전체 메모(삭제·잠금 제외)의 위키·태그 → 대표 표기 + 사용 횟수 */
export async function buildVocab(supabase: SupabaseClient, userId: string): Promise<Vocab> {
  const rows: { tags: string[] | null; wiki_links: string[] | null }[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('memos')
      .select('tags, wiki_links')
      .eq('user_id', userId)
      .eq('is_deleted', false)
      .eq('is_locked', false) // 잠금 메모 내용은 절대 AI에 넣지 않는다
      .range(from, from + PAGE - 1)
    if (error) throw new Error(`어휘 목록 조회 실패: ${error.message}`)
    rows.push(...((data ?? []) as typeof rows))
    if (!data || data.length < PAGE) break
  }

  const wikiEntries = rows.flatMap((r) => (r.wiki_links ?? []).map((label) => ({ label, count: 1 })))
  const tagEntries = rows.flatMap((r) => (r.tags ?? []).map((label) => ({ label, count: 1 })))
  const wikiCanonical = buildCanonicalMap(wikiEntries, wikiKey)
  const tagCanonical = buildCanonicalMap(tagEntries, tagKey)

  return {
    wikiCanonical,
    tagCanonical,
    wikiList: rankWithCounts(wikiEntries, wikiCanonical, wikiKey, VOCAB_WIKI_LIMIT),
    tagList: rankWithCounts(tagEntries, tagCanonical, tagKey, VOCAB_TAG_LIMIT),
  }
}

function rankWithCounts(
  entries: { label: string; count: number }[],
  canonical: Map<string, string>,
  keyFn: (s: string) => string,
  limit: number,
): string[] {
  const counts = new Map<string, number>()
  for (const { label } of entries) {
    const k = keyFn(label.trim())
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => (b[1] - a[1]) || (canonical.get(a[0]) ?? a[0]).localeCompare(canonical.get(b[0]) ?? b[0], 'ko'))
    .slice(0, limit)
    .map(([k, n]) => `${canonical.get(k) ?? k}(${n})`)
}

// ── 표기 정리 ──

/** 위키: `[`·`]` 제거, 공백 제거(붙여쓰기 컨벤션) */
export function cleanWiki(name: string): string {
  return name.replace(/[[\]]/g, '').replace(/\s+/g, '').trim()
}

/** 태그: 에디터 추출 정규식 `#([\w가-힣]+)`가 읽을 수 있는 문자만 */
export function cleanTag(name: string): string {
  return name.replace(/^#+/, '').replace(/[^\w가-힣]/g, '')
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter(Boolean) : [])

function rawSuggestions(v: unknown): { name: string; reason: string }[] {
  if (!Array.isArray(v)) return []
  return v
    .map((x) => (typeof x === 'string'
      ? { name: x, reason: '' }
      : { name: str((x as Record<string, unknown>)?.name), reason: str((x as Record<string, unknown>)?.reason) }))
    .filter((x) => x.name)
}

/** 모델이 준 이름 목록 → 정규화·대표 표기 치환·중복 제거·source 교정 */
export function normalizeSuggestions(
  items: { name: string; reason: string }[],
  kind: 'wiki' | 'tag',
  canonical: Map<string, string>,
): NoteSuggestion[] {
  const keyFn = kind === 'wiki' ? wikiKey : tagKey
  const clean = kind === 'wiki' ? cleanWiki : cleanTag
  const seen = new Set<string>()
  const out: NoteSuggestion[] = []
  let newCount = 0
  for (const it of items) {
    // 문법 기호(`[[ ]]`·`#`)를 먼저 떼고 대표 표기로 치환 — 키 계산이 공백을 무시하므로
    // 띄어쓴 표기도 여기서 기존 어휘에 붙는다
    const bare = kind === 'wiki' ? it.name.replace(/[[\]]/g, '') : it.name.replace(/^#+/, '')
    const resolved = resolveToCanonical(bare, canonical, keyFn)
    const existing = canonical.has(keyFn(resolved))
    const name = existing ? resolved : clean(resolved)
    const key = keyFn(name)
    if (!name || !key || seen.has(key)) continue
    if (!existing && kind === 'wiki') {
      if (newCount >= MAX_NEW_WIKIS) continue
      newCount++
    }
    seen.add(key)
    out.push({ name, source: existing ? 'existing' : 'new', reason: it.reason })
  }
  return out
}

/** 종합 출력 길이 상한 — 섹션당 불릿 6개, 불릿당 2문장 (프롬프트와 같은 값, 서버가 다시 강제) */
export const MAX_BULLETS_PER_SECTION = 6
export const MAX_SENTENCES_PER_BULLET = 2

/** 불릿을 앞 N문장으로 자른다 (마침표·물음표·느낌표 + 공백 기준) */
export function limitSentences(s: string, n = MAX_SENTENCES_PER_BULLET): string {
  const parts = s.split(/(?<=[.!?。])\s+/)
  return parts.length <= n ? s : parts.slice(0, n).join(' ')
}

/**
 * 개념 이름 → 위키로 쓸 수 있는 하나의 명사.
 * 괄호 설명 제거("매출선형모델(S=…)" → "매출선형모델"), 가운뎃점·슬래시로 묶인 쌍은 앞쪽 하나
 * ("선행지표·후행지표" → "선행지표"), 붙여쓰기.
 */
export function cleanConceptName(name: string): string {
  const noParen = name.replace(/\([^)]*\)|（[^）]*）/g, ' ')
  const first = noParen.split(/[·‧・/]/)[0]
  return cleanWiki(first)
}

/** 모델 원본 JSON → SourceNoteAnalysis (형식 강제 + 위키·태그 교정) */
export function normalizeAnalysis(raw: Record<string, unknown>, vocab: Vocab): SourceNoteAnalysis {
  const sections = Array.isArray(raw.sections)
    ? raw.sections
        .map((s) => ({
          heading: str((s as Record<string, unknown>)?.heading),
          bullets: strArr((s as Record<string, unknown>)?.bullets).slice(0, MAX_BULLETS_PER_SECTION).map((b) => limitSentences(b)),
        }))
        .filter((s) => s.heading || s.bullets.length)
    : []
  const concepts = Array.isArray(raw.concepts)
    ? raw.concepts
        .map((c) => {
          const original = str((c as Record<string, unknown>)?.name)
          const name = cleanConceptName(original)
          const definition = str((c as Record<string, unknown>)?.definition)
          // 이름을 줄였으면 원래 표기를 정의 앞에 남긴다 (예: (선행지표·후행지표) …)
          const dropped = original && cleanWiki(original) !== name
          return { name, definition: dropped ? `(${original}) ${definition}`.trim() : definition }
        })
        .filter((c) => c.name)
    : []
  const quotes = Array.isArray(raw.quotes)
    ? raw.quotes
        .map((q) => {
          const text = str((q as Record<string, unknown>)?.text)
          const loc = str((q as Record<string, unknown>)?.loc)
          return loc ? { text, loc } : { text }
        })
        .filter((q) => q.text)
    : []
  const ta = str(raw.textAmount)
  const textAmount: SourceNoteAnalysis['textAmount'] = ta === 'low' || ta === 'some' ? ta : 'rich'

  const title = str(raw.title) || '제목 없는 요약'
  return {
    title: title.slice(0, 120),
    oneLiner: str(raw.oneLiner),
    keyPoints: strArr(raw.keyPoints),
    sections,
    // 개념 이름도 기존 어휘 표기에 맞춘다 — 본문 [[개념]]이 기존 허브로 붙도록
    concepts: concepts.map((c) => ({ ...c, name: resolveToCanonical(c.name, vocab.wikiCanonical, wikiKey) })),
    quotes,
    wikiSuggestions: normalizeSuggestions(rawSuggestions(raw.wikiSuggestions), 'wiki', vocab.wikiCanonical),
    tagSuggestions: normalizeSuggestions(rawSuggestions(raw.tagSuggestions), 'tag', vocab.tagCanonical),
    textAmount,
  }
}

/**
 * 개념 → 새 위키 후보. 실측에서 어휘가 많으면 모델이 전부 기존 표기만 재사용해 새 위키가 0개였다
 * (이 자료만의 핵심 개념이 그래프 허브가 되지 못함). concepts 중 기존 어휘에 같은 키가 없는 것을
 * 새 위키 후보로 넣는다 — 새 위키 총 3개 안에서 개념 출신을 우선하고, 서버가 만든 후보는
 * fromConcept로 표시해 모달에서 기본 해제(사용자가 고른다).
 */
export function promoteConceptWikis(analysis: SourceNoteAnalysis, vocab: Vocab): void {
  const conceptKeys = new Set(analysis.concepts.map((c) => wikiKey(c.name)).filter(Boolean))
  const suggested = new Set(analysis.wikiSuggestions.map((s) => wikiKey(s.name)))
  const existing = analysis.wikiSuggestions.filter((s) => s.source !== 'new')
  const modelNew = analysis.wikiSuggestions.filter((s) => s.source === 'new')

  const fromConcepts: NoteSuggestion[] = []
  for (const c of analysis.concepts) {
    const key = wikiKey(c.name)
    if (!key || suggested.has(key) || vocab.wikiCanonical.has(key)) continue
    suggested.add(key)
    const def = c.definition.replace(/^\([^)]*\)\s*/, '')
    fromConcepts.push({
      name: c.name,
      source: 'new',
      reason: `이 자료의 핵심 개념${def ? ` — ${def.slice(0, 50)}${def.length > 50 ? '…' : ''}` : ''}`,
      fromConcept: true,
    })
  }

  // 우선순위: 모델 new 중 개념과 같은 것 → 개념 출신 → 나머지 모델 new, 총 MAX_NEW_WIKIS개
  const ordered = [
    ...modelNew.filter((s) => conceptKeys.has(wikiKey(s.name))),
    ...fromConcepts,
    ...modelNew.filter((s) => !conceptKeys.has(wikiKey(s.name))),
  ].slice(0, MAX_NEW_WIKIS)
  analysis.wikiSuggestions = [...existing, ...ordered]
}

/**
 * 이웃 기반 추천 (4-4 ③④): 요약 임베딩 → 유사 메모 상위 5개(잠금·삭제 제외) →
 * 그들의 위키 중 2개 이상 메모에서 등장하거나 concepts와 키가 겹치는 것을 neighbor로 추가.
 * 실패는 fail-open (빈 결과).
 */
export async function findNeighbors(
  supabase: SupabaseClient,
  userId: string,
  analysis: SourceNoteAnalysis,
  vocab: Vocab,
  /** 임베딩 함수 — 기본 OpenAI. 저장된 임베딩으로 검증할 때 주입 */
  embed: (text: string) => Promise<number[]> = embedText,
): Promise<{ related: RelatedMemoRef[]; neighbors: NoteSuggestion[] }> {
  try {
    const input = [analysis.oneLiner, ...analysis.keyPoints].filter(Boolean).join('\n')
    if (!input.trim()) return { related: [], neighbors: [] }
    const queryEmbedding = await embed(input)
    const { data: matches, error } = await supabase.rpc('match_memos', {
      query_embedding: queryEmbedding,
      match_threshold: NEIGHBOR_THRESHOLD,
      match_count: NEIGHBOR_COUNT * 2, // 잠금 메모를 걸러낸 뒤에도 5개가 남도록 여유
      exclude_id: null,
      user_id_filter: userId,
    })
    if (error) throw error
    const matched = (matches ?? []) as { id: string; title: string; similarity: number }[]
    if (matched.length === 0) return { related: [], neighbors: [] }

    const { data: rows } = await supabase
      .from('memos')
      .select('id, title, wiki_links')
      .in('id', matched.map((m) => m.id))
      .eq('is_locked', false)
      .eq('is_deleted', false)
    const byId = new Map((rows ?? []).map((r) => [r.id as string, r]))
    const top = matched.filter((m) => byId.has(m.id)).slice(0, NEIGHBOR_COUNT)

    const related: RelatedMemoRef[] = top.map((m) => ({
      id: m.id,
      title: (byId.get(m.id)?.title as string) || '제목 없음',
      similarity: Math.round(m.similarity * 1000) / 1000,
    }))

    const counts = new Map<string, number>()
    for (const m of top) {
      const keys = new Set(((byId.get(m.id)?.wiki_links as string[] | null) ?? []).map((w) => wikiKey(w)).filter(Boolean))
      for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    const conceptKeys = new Set(analysis.concepts.map((c) => wikiKey(c.name)))
    const already = new Set(analysis.wikiSuggestions.map((s) => wikiKey(s.name)))

    const neighbors: NoteSuggestion[] = [...counts.entries()]
      .filter(([k, n]) => !already.has(k) && (n >= 2 || conceptKeys.has(k)))
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_NEIGHBOR_SUGGESTIONS)
      .map(([k, n]) => ({
        name: vocab.wikiCanonical.get(k) ?? k,
        source: 'neighbor' as const,
        reason: `비슷한 메모 ${n}개에서 쓰는 위키`,
        neighborCount: n,
      }))
    return { related, neighbors }
  } catch (e) {
    console.warn('[source-note] 이웃 추천 건너뜀:', e instanceof Error ? e.message : e)
    return { related: [], neighbors: [] }
  }
}

/** 모델 원본 → 정규화 → 개념 출신 새 위키 → 이웃 추천 (analyze 단일 경로·synthesize 공용) */
export async function finalizeAnalysis(
  supabase: SupabaseClient,
  userId: string,
  raw: Record<string, unknown>,
  vocab: Vocab,
): Promise<{ analysis: SourceNoteAnalysis; related: RelatedMemoRef[] }> {
  const analysis = normalizeAnalysis(raw, vocab)
  promoteConceptWikis(analysis, vocab)
  const { related, neighbors } = await findNeighbors(supabase, userId, analysis, vocab)
  analysis.wikiSuggestions.push(...neighbors)
  return { analysis, related }
}
