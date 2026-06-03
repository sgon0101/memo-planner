/**
 * 기존 메모 임베딩 일괄 생성 (backfill)
 *
 * POST /api/embeddings/backfill
 * body: { limit?: number }  // 한 번에 처리할 메모 수 (default 50)
 *
 * 흐름:
 *  1. 인증 사용자 본인 메모 중 embedding IS NULL인 것 limit개 fetch
 *  2. OpenAI batch 임베딩 호출
 *  3. 결과를 차례로 update
 *  4. 남은 개수도 같이 반환 (클라이언트가 반복 호출 가능)
 *
 * 사용:
 *   for (;;) {
 *     const r = await fetch('/api/embeddings/backfill', {method:'POST', body:'{}'}).then(r=>r.json())
 *     if (r.remaining === 0 || r.processed === 0) break
 *     console.log(r)
 *   }
 */

import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { embedBatch, buildMemoEmbeddingInput } from '@/lib/ai/embeddings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100

interface Body {
  limit?: number
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })

    const body = (await req.json().catch(() => ({}))) as Body
    const limit = Math.min(body.limit ?? DEFAULT_LIMIT, MAX_LIMIT)

    // embedding이 비어있는 메모 limit개
    const { data: memos, error: fetchErr } = await supabase
      .from('memos')
      .select('id, title, content_text')
      .eq('user_id', user.id)
      .eq('is_deleted', false)
      .is('embedding', null)
      .limit(limit)
    if (fetchErr) {
      console.error('[backfill] fetch', fetchErr)
      return Response.json({ error: fetchErr.message }, { status: 500 })
    }

    if (!memos || memos.length === 0) {
      // 전체 남은 메모 갯수 계산
      const { count } = await supabase
        .from('memos')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('is_deleted', false)
        .is('embedding', null)
      return Response.json({ processed: 0, remaining: count ?? 0 })
    }

    // 텍스트가 비어있는 메모는 빈 스페이스로 (OpenAI는 빈 입력 거부)
    const inputs = memos.map((m) => buildMemoEmbeddingInput(m.title, m.content_text ?? ''))
    const placeholders = inputs.map((s) => (s || ' '))

    const vectors = await embedBatch(placeholders)

    // 결과 일괄 업데이트
    let processed = 0
    let failed = 0
    const errors: string[] = []
    for (let i = 0; i < memos.length; i++) {
      const memo = memos[i]
      const vec = vectors[i]
      // 빈 텍스트인 메모는 임베딩 결과를 저장하지 않음 (의미 없는 벡터)
      if (!inputs[i]) {
        // updated_at만 찍어 다음 backfill에서 다시 pickup하지 않게
        await supabase.from('memos').update({ embedding_updated_at: new Date().toISOString() }).eq('id', memo.id)
        continue
      }
      const { error } = await supabase
        .from('memos')
        .update({
          embedding: vec as unknown as string,
          embedding_updated_at: new Date().toISOString(),
        })
        .eq('id', memo.id)
      if (error) {
        failed++
        errors.push(`${memo.id}: ${error.message}`)
      } else {
        processed++
      }
    }

    // 남은 갯수
    const { count: remaining } = await supabase
      .from('memos')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', user.id)
      .eq('is_deleted', false)
      .is('embedding', null)

    return Response.json({
      processed,
      failed,
      remaining: remaining ?? 0,
      errors: errors.slice(0, 5),
    })
  } catch (err) {
    console.error('[backfill]', err)
    return Response.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    )
  }
}
