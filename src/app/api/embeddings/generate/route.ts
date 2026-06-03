/**
 * 단일 메모 임베딩 생성 / 갱신
 *
 * POST /api/embeddings/generate
 * body: { memoId }
 *
 * 흐름:
 *  1. 인증 사용자 확인
 *  2. 해당 memoId의 title + content_text fetch (소유권 검증 포함)
 *  3. OpenAI 임베딩 호출
 *  4. embedding + embedding_updated_at 업데이트
 */

import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { embedText, buildMemoEmbeddingInput } from '@/lib/ai/embeddings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Body {
  memoId?: string
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })

    const body = (await req.json()) as Body
    const memoId = body.memoId
    if (!memoId) return Response.json({ error: 'memoId required' }, { status: 400 })

    // 메모 조회 + 소유권 검증
    const { data: memo, error: fetchErr } = await supabase
      .from('memos')
      .select('id, user_id, title, content_text, is_deleted')
      .eq('id', memoId)
      .maybeSingle()
    if (fetchErr || !memo) return Response.json({ error: 'memo not found' }, { status: 404 })
    if (memo.user_id !== user.id) return Response.json({ error: 'forbidden' }, { status: 403 })
    if (memo.is_deleted) return Response.json({ error: 'memo deleted' }, { status: 400 })

    const input = buildMemoEmbeddingInput(memo.title, memo.content_text ?? '')
    if (!input) {
      // 텍스트 없는 메모 — 임베딩 무의미, 그냥 OK 반환
      return Response.json({ ok: true, skipped: 'empty' })
    }

    const vector = await embedText(input)

    const { error: updErr } = await supabase
      .from('memos')
      .update({
        embedding: vector as unknown as string, // pgvector는 array 그대로 받음
        embedding_updated_at: new Date().toISOString(),
      })
      .eq('id', memoId)
    if (updErr) {
      console.error('[embeddings/generate] update', updErr)
      return Response.json({ error: updErr.message }, { status: 500 })
    }

    return Response.json({ ok: true })
  } catch (err) {
    console.error('[embeddings/generate]', err)
    return Response.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    )
  }
}
