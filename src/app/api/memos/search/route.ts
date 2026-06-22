/**
 * Postgres FTS + pg_trgm 메모 검색 (PR-6)
 *
 * GET /api/memos/search?q=...&folder=<id|trash|all>&limit=100
 *
 * 동작:
 *   - search_memos() RPC 호출 (0012 마이그레이션)
 *   - FTS websearch_to_tsquery 1차 매칭 → ts_rank 정렬
 *   - hit 부족 시 trigram similarity로 보조 매칭 (한국어 합성어 대응)
 *   - 단일 score(0~1)로 통합 정렬
 *
 * 예시:
 *   "회의" → "회의록 작성", "회의실 예약", "주간회의" 모두 매칭됨
 */

import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { toMemo } from '@/lib/memos/shared'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const rawQ = (searchParams.get('q') || '').trim()
    const folder = searchParams.get('folder') || 'all'
    const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10), 500)

    if (!rawQ) return Response.json({ results: [], total: 0 })

    // prefix 정리 — #태그, [[위키 모두 본문 검색으로
    let q = rawQ
    if (q.startsWith('[[')) q = q.slice(2).replace(/\]\]$/, '')
    else if (q.startsWith('#')) q = q.slice(1)
    if (!q.trim()) return Response.json({ results: [], total: 0 })

    const trashFilter = folder === 'trash'
    const folderFilter = (!trashFilter && folder && folder !== 'all') ? folder : null

    const { data, error } = await supabase.rpc('search_memos', {
      q,
      user_id_filter: user.id,
      folder_filter: folderFilter,
      trash_filter: trashFilter,
      max_results: limit,
    })

    if (error) {
      console.error('[memos/search]', error)
      return Response.json({ error: error.message }, { status: 500 })
    }

    const results = (data ?? []).map(toMemo)
    return Response.json({ results, total: results.length })
  } catch (err) {
    console.error('[memos/search] unexpected', err)
    return Response.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    )
  }
}
