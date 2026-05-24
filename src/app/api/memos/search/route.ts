/**
 * Postgres FTS 기반 메모 검색 (#9)
 *
 * GET /api/memos/search?q=...&folder=<id|trash|all>&limit=100
 *
 * - search_vec(tsvector) 컬럼 + websearch_to_tsquery 사용
 * - 사용자가 자연어로 검색 ("회의 일정", "회의 OR 미팅" 등 — websearch syntax)
 * - prefix(#tag, [[wiki)는 자연스럽게 무시되고 본문에서 매칭됨
 * - 결과는 ts_rank로 관련도순, 동일 점수면 updated_at 내림차순
 */

import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { LIST_COLS, toMemo } from '@/lib/memos/shared'

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

    // prefix 정리 — #태그, [[위키 모두 본문 검색으로 처리 (특수문자 제거)
    let q = rawQ
    if (q.startsWith('[[')) q = q.slice(2).replace(/\]\]$/, '')
    else if (q.startsWith('#')) q = q.slice(1)
    if (!q.trim()) return Response.json({ results: [], total: 0 })

    let qb = supabase
      .from('memos')
      .select(LIST_COLS)
      .eq('user_id', user.id)

    if (folder === 'trash') {
      qb = qb.eq('is_deleted', true)
    } else {
      qb = qb.eq('is_deleted', false)
      if (folder && folder !== 'all') {
        qb = qb.eq('folder_id', folder)
      }
    }

    // textSearch — websearch는 "AND OR NOT 인용구" 지원
    qb = qb.textSearch('search_vec', q, { type: 'websearch', config: 'simple' })
    qb = qb.order('updated_at', { ascending: false }).limit(limit)

    const { data, error } = await qb
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
