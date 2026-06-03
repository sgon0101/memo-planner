/**
 * 의미 기반 관련 메모 조회
 *
 * GET /api/memos/[id]/related?limit=5&threshold=0.5
 *
 * 흐름:
 *  1. 인증 사용자의 해당 메모의 embedding 가져오기
 *  2. RPC match_memos로 cosine 유사도 검색
 *  3. 자기 자신 제외, 본인 메모만, threshold 이상
 */

import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const url = new URL(req.url)
    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '5', 10) || 5, 20)
    const threshold = parseFloat(url.searchParams.get('threshold') ?? '0.4')

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })

    // 원본 메모의 embedding 가져오기
    const { data: source, error: srcErr } = await supabase
      .from('memos')
      .select('id, user_id, embedding')
      .eq('id', id)
      .maybeSingle()
    if (srcErr || !source) return Response.json({ error: 'memo not found' }, { status: 404 })
    if (source.user_id !== user.id) return Response.json({ error: 'forbidden' }, { status: 403 })
    if (!source.embedding) {
      return Response.json({ items: [], reason: 'no embedding yet' })
    }

    // RPC 호출 — 의미 유사 메모 찾기
    const { data: matches, error: rpcErr } = await supabase.rpc('match_memos', {
      query_embedding: source.embedding,
      match_threshold: threshold,
      match_count: limit,
      exclude_id: id,
      user_id_filter: user.id,
    })
    if (rpcErr) {
      console.error('[related] rpc', rpcErr)
      return Response.json({ error: rpcErr.message }, { status: 500 })
    }

    return Response.json({ items: matches ?? [] })
  } catch (err) {
    console.error('[related]', err)
    return Response.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    )
  }
}
