/**
 * 의미 기반 메모 검색 (시맨틱 폴백)
 *
 * GET /api/memos/search-semantic?q=...&limit=20
 *
 * 용도: FTS(/api/memos/search)가 0건일 때 클라이언트가 폴백으로 호출.
 * "정확한 단어가 기억나지 않는" 검색 실패 경험을 임베딩 유사도로 구제한다.
 *
 * 흐름:
 *  1. 검색어를 OpenAI 임베딩으로 변환
 *  2. match_memos RPC로 cosine 유사도 상위 N개 조회
 *  3. 목록 렌더에 필요한 LIST_COLS 재조회 → Memo 형태로 반환 (잠금 메모 제외)
 *
 * 실패 시(임베딩 키 미설정 등) 빈 결과 반환 — 검색 UI를 막지 않는다.
 */

import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { embedText } from '@/lib/ai/embeddings'
import { LIST_COLS, toMemo } from '@/lib/memos/shared'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50
const MATCH_THRESHOLD = 0.3

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const q = (searchParams.get('q') || '').trim()
    const limit = Math.min(parseInt(searchParams.get('limit') || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT, MAX_LIMIT)

    if (q.length < 2) return Response.json({ results: [], total: 0 })

    let queryEmbedding: number[]
    try {
      queryEmbedding = await embedText(q)
    } catch (e) {
      // 임베딩 불가(키 미설정 등) — 조용히 빈 결과 (fail-open)
      console.warn('[memos/search-semantic] embed skip:', e instanceof Error ? e.message : e)
      return Response.json({ results: [], total: 0 })
    }

    const { data: matches, error: rpcErr } = await supabase.rpc('match_memos', {
      query_embedding: queryEmbedding,
      match_threshold: MATCH_THRESHOLD,
      match_count: limit,
      exclude_id: null,
      user_id_filter: user.id,
    })
    if (rpcErr) {
      console.error('[memos/search-semantic] rpc', rpcErr)
      return Response.json({ results: [], total: 0 })
    }

    const ids = ((matches ?? []) as { id: string }[]).map((m) => m.id)
    if (ids.length === 0) return Response.json({ results: [], total: 0 })

    // 목록 렌더용 컬럼 재조회 — 잠금 메모는 시맨틱 결과에서 제외
    const { data: rows, error: rowErr } = await supabase
      .from('memos')
      .select(LIST_COLS)
      .in('id', ids)
      .eq('is_deleted', false)
      .eq('is_locked', false)
    if (rowErr) {
      console.error('[memos/search-semantic] rows', rowErr)
      return Response.json({ results: [], total: 0 })
    }

    // 유사도 순서 유지
    const order = new Map(ids.map((id, i) => [id, i]))
    const results = (rows ?? [])
      .slice()
      .sort((a, b) => (order.get((a as { id: string }).id) ?? 99) - (order.get((b as { id: string }).id) ?? 99))
      .map((r) => toMemo(r as Record<string, unknown>))

    return Response.json({ results, total: results.length, semantic: true })
  } catch (err) {
    console.error('[memos/search-semantic] unexpected', err)
    return Response.json({ results: [], total: 0 })
  }
}
