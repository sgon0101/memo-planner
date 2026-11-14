import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

/**
 * 그래프 유사도 링크 — 임베딩 상호 최근접(mutual kNN)
 *
 * 2026-11-14 교체: 예전엔 메모별 빈출 단어 상위 10개 중 2개 이상 겹치면 연결했는데,
 * 상위 단어가 '있는·내가·그리고' 같은 일상어라 링크 85%가 주제와 무관했고
 * 그 그물이 모든 메모를 그래프 중앙으로 끌어당겼다.
 *
 * 지금은 DB 함수 graph_similarity_links(0025)가 계산한다:
 * 서로가 서로의 가장 비슷한 메모 상위 K개 안에 있고 유사도가 MIN_SIM 이상일 때만 연결.
 * 상호 조건이라 메모당 링크가 최대 K개 — 모든 걸 끌어당기는 노드가 생기지 않는다.
 * 잠금·삭제·임베딩 없는 메모는 DB 함수에서 제외된다.
 */
const K = 5
const MIN_SIM = 0.5

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase.rpc('graph_similarity_links', { p_k: K, p_min_sim: MIN_SIM })
  if (error) {
    // 실패를 빈 링크로 위장하지 않는다 — 클라이언트는 !ok면 기존 캐시 표시를 유지
    console.error('[graph/analyze] graph_similarity_links 실패', error.message)
    return NextResponse.json({ error: '유사도 계산에 실패했어요' }, { status: 500 })
  }

  const links = (data ?? []).map((r: { source: string; target: string; similarity: number }) => ({
    source: r.source,
    target: r.target,
    type: 'similarity' as const,
    similarity: Math.round(r.similarity * 1000) / 1000,
  }))

  return NextResponse.json({ links })
}
