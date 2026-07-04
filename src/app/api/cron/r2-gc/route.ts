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

// content_text + content jsonb 안에 url이 나타나는지
function contentReferencesUrl(contentText: string | null, content: unknown, url: string): boolean {
  if (contentText && contentText.includes(url)) return true
  if (content) {
    try {
      const j = typeof content === 'string' ? content : JSON.stringify(content)
      if (j.includes(url)) return true
    } catch { /* ignore */ }
  }
  return false
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
    .select('id, user_id, r2_key, public_url, thumbnail_url, medium_url')
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
    // 사용자의 활성 메모 (휴지통 제외) 본문 모두 가져오기
    // 페이지네이션 — 본문이 크니까 1000개씩
    const memoBodies: Array<{ content_text: string | null; content: unknown }> = []
    let from = 0
    while (true) {
      const { data: batch, error } = await supabase
        .from('memos')
        .select('content_text, content')
        .eq('user_id', userId)
        .eq('is_deleted', false)
        .order('created_at', { ascending: true })
        .range(from, from + 999)
      if (error || !batch || batch.length === 0) break
      memoBodies.push(...batch as typeof memoBodies)
      if (batch.length < 1000) break
      from += 1000
    }

    for (const f of userFiles) {
      totalChecked++
      const url = f.public_url as string
      // 메모 본문 어딘가에 url이 들어있나?
      const isReferenced = memoBodies.some((m) =>
        contentReferencesUrl(m.content_text as string | null, m.content, url)
      )

      if (isReferenced) {
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
