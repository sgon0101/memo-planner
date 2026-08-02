/**
 * R2 garbage collection cron (PR-3).
 *
 * GET /api/cron/r2-gc
 *   - Bearer ${CRON_SECRET} 인증
 *   - 모든 사용자의 uploaded_files 순회
 *   - 각 파일의 public_url이 메모 본문(content_text 또는 content jsonb)에
 *     포함돼 있지 않으면 orphan → R2 + DB row 삭제
 *   - 안전 가드: created_at < now - 7d (방금 업로드된 파일은 보호)
 *   - 휴지통 메모(is_deleted=true)는 복원 가능하므로 GC 제외
 *   - 변형(thumbnail_url, medium_url)도 함께 삭제
 *
 * 옵션:
 *   ?dryRun=1 — 실제 삭제 없이 후보만 카운트
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSbClient } from '@supabase/supabase-js'
import { verifyCronAuth } from '@/lib/security/cronAuth'
import { deleteFromR2 } from '@/lib/r2/upload'

export const runtime = 'nodejs'
export const maxDuration = 300

const SAFE_WINDOW_DAYS = 7

// r2_key를 URL에서 추출 (R2_PUBLIC_URL 기준)
function extractR2KeyFromUrl(url: string): string | null {
  try {
    const u = new URL(url)
    return u.pathname.replace(/^\//, '')
  } catch {
    return null
  }
}

/**
 * content_text + content jsonb에서 R2 URL을 뽑아 집합에 넣는다.
 *
 * 파일마다 전체 본문을 재순회(JSON.stringify)하던 기존 방식 대신 한 번만 훑어
 * URL 집합을 만든다 — 메모+버전 이력까지 스캔해야 해서 비용 차이가 크다.
 */
function collectR2Urls(contentText: string | null, content: unknown, into: Set<string>): void {
  const pieces: string[] = []
  if (contentText) pieces.push(contentText)
  if (content) {
    try {
      pieces.push(typeof content === 'string' ? content : JSON.stringify(content))
    } catch { /* ignore */ }
  }
  for (const p of pieces) {
    for (const m of p.match(/https?:\/\/[^"'\s\\)]+/g) ?? []) {
      into.add(m.split('?')[0])
    }
  }
}

export async function GET(req: NextRequest) {
  if (!verifyCronAuth(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const dryRun = new URL(req.url).searchParams.get('dryRun') === '1'

  const supabase = createSbClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const cutoff = new Date(Date.now() - SAFE_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()

  // 1) GC 후보: 7일보다 오래된 uploaded_files만
  // user_id별로 그룹화해서 처리 (메모 fetch 효율화)
  const { data: files } = await supabase
    .from('uploaded_files')
    .select('id, user_id, memo_id, r2_key, public_url, thumbnail_url, medium_url')
    .lt('created_at', cutoff)
    .limit(10_000)  // 한 회 최대 1만 row

  if (!files || files.length === 0) {
    return NextResponse.json({
      checked: 0, deleted: 0, kept: 0, dryRun,
      message: '검사할 파일 없음 (모두 7일 이내 업로드).',
    })
  }

  // 사용자별 그룹핑
  const byUser = new Map<string, typeof files>()
  for (const f of files) {
    const uid = f.user_id as string
    if (!byUser.has(uid)) byUser.set(uid, [])
    byUser.get(uid)!.push(f)
  }

  let totalChecked = 0
  let totalDeleted = 0
  let totalKept = 0
  const errors: string[] = []

  for (const [userId, userFiles] of byUser.entries()) {
    // ⚠️ 2026-07-05 사고 재발 방지 가드 3종 —
    // 구버전은 메모 페치가 에러나도(대용량 content 배치 실패 등) 그대로 GC를 진행해,
    // 못 읽은 메모들이 참조하는 살아있는 이미지를 orphan으로 오판·삭제했다.
    // (16MB base64 메모가 배치를 터뜨림 → 이후 배치 미페치 → 해당 메모들 이미지 삭제)
    // ①페치 에러 시 해당 사용자 GC 전체 스킵 ②페치 수와 실제 메모 수 대조
    // ③memo_id가 활성 메모에 연결된 파일은 URL 스캔 없이 무조건 보존 (잠금 메모 커버)
    const referencedUrls = new Set<string>()
    const memoIds: string[] = []
    let lockedMemoCount = 0
    let fetchFailed = false
    let fetchedMemos = 0
    let from = 0
    while (true) {
      const { data: batch, error } = await supabase
        .from('memos')
        .select('id, content_text, content, is_locked')
        .eq('user_id', userId)
        .eq('is_deleted', false)
        .order('created_at', { ascending: true })
        .range(from, from + 199)  // 1000→200: 대용량 content로 인한 배치 실패 확률 축소
      if (error) { fetchFailed = true; break }
      if (!batch || batch.length === 0) break
      for (const m of batch as Array<{ id: string; content_text: string | null; content: unknown; is_locked: boolean }>) {
        memoIds.push(m.id)
        if (m.is_locked) lockedMemoCount++
        collectR2Urls(m.content_text, m.content, referencedUrls)
      }
      fetchedMemos += batch.length
      if (batch.length < 200) break
      from += 200
    }

    // 가드 ②: 실제 활성 메모 수와 페치 수가 다르면 부분 페치 — GC 스킵
    const { count: memoCount, error: countErr } = await supabase
      .from('memos')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('is_deleted', false)

    if (fetchFailed || countErr || memoCount == null || fetchedMemos !== memoCount) {
      errors.push(`user ${userId}: memo fetch incomplete (${fetchedMemos}/${memoCount ?? '?'}) — GC 스킵 (fail-safe)`)
      continue
    }

    // 가드 ④(신규): 버전 이력도 스캔한다.
    // 본문에서 지웠지만 이전 버전에만 남은 이미지를 orphan으로 오판하면,
    // 나중에 버전 복원을 해도 이미지가 이미 삭제된 상태가 된다.
    let versionFetchFailed = false
    for (let i = 0; i < memoIds.length && !versionFetchFailed; i += 50) {
      const chunk = memoIds.slice(i, i + 50)
      let vFrom = 0
      while (true) {
        const { data: vBatch, error: vErr } = await supabase
          .from('memo_versions')
          .select('content, content_text')
          .in('memo_id', chunk)
          .range(vFrom, vFrom + 199)
        if (vErr) { versionFetchFailed = true; break }
        if (!vBatch || vBatch.length === 0) break
        for (const v of vBatch as Array<{ content: unknown; content_text: string | null }>) {
          collectR2Urls(v.content_text, v.content, referencedUrls)
        }
        if (vBatch.length < 200) break
        vFrom += 200
      }
    }
    if (versionFetchFailed) {
      errors.push(`user ${userId}: memo_versions fetch 실패 — GC 스킵 (fail-safe)`)
      continue
    }

    const activeMemoIds = new Set(memoIds)

    for (const f of userFiles) {
      totalChecked++
      // 가드 ③: 활성 메모에 연결된 파일은 본문 스캔 없이 보존
      // (잠금 메모는 content가 암호화돼 URL 스캔이 불가능 — memo_id 연결로만 판정 가능)
      const linkedMemoId = (f as Record<string, unknown>).memo_id as string | null
      if (linkedMemoId && activeMemoIds.has(linkedMemoId)) {
        totalKept++
        continue
      }

      // 가드 ⑤(신규): 잠금 메모가 하나라도 있으면, memo_id가 없는 파일은 "참조 없음"을
      // 증명할 수 없다 — 잠금 메모는 content가 암호화라 URL 스캔이 통하지 않기 때문.
      // 증명 불가 = 보존 (잘못 지우는 쪽이 쓰레기를 남기는 쪽보다 훨씬 나쁘다).
      if (lockedMemoCount > 0 && !linkedMemoId) {
        totalKept++
        continue
      }

      // 가드 ⑥(신규): 원본뿐 아니라 변형(md_/thumb_) URL도 참조로 인정한다.
      // 본문 image node의 src가 변형 URL인 경우가 있어(에디터 소형 표시 등),
      // 원본 URL만 비교하면 살아있는 이미지를 orphan으로 오판하고
      // 삭제 시 변형까지 함께 지워버린다.
      const candidateUrls = [f.public_url, f.medium_url, f.thumbnail_url]
        .filter((u): u is string => typeof u === 'string' && u.length > 0)
        .map((u) => u.split('?')[0])

      if (candidateUrls.some((u) => referencedUrls.has(u))) {
        totalKept++
        continue
      }

      // Orphan — R2 + DB 삭제
      if (dryRun) {
        totalDeleted++
        continue
      }

      // R2 객체 삭제 (원본 + 변형)
      const keysToDelete = [f.r2_key as string]
      if (f.thumbnail_url) {
        const k = extractR2KeyFromUrl(f.thumbnail_url as string)
        if (k) keysToDelete.push(k)
      }
      if (f.medium_url) {
        const k = extractR2KeyFromUrl(f.medium_url as string)
        if (k) keysToDelete.push(k)
      }
      for (const k of keysToDelete) {
        try { await deleteFromR2(k) } catch (e) {
          errors.push(`r2 delete ${k}: ${e instanceof Error ? e.message : 'unknown'}`)
        }
      }

      // DB row 삭제
      const { error: delErr } = await supabase.from('uploaded_files').delete().eq('id', f.id)
      if (delErr) {
        errors.push(`db delete ${f.id}: ${delErr.message}`)
      } else {
        totalDeleted++
      }
    }
  }

  return NextResponse.json({
    checked: totalChecked,
    deleted: totalDeleted,
    kept: totalKept,
    users: byUser.size,
    dryRun,
    errors: errors.slice(0, 20),
    errorCount: errors.length,
  })
}
