/**
 * 임베딩 인덱싱 진행률 — 설정 페이지에서 사용.
 *
 * GET /api/embeddings/status
 *
 * 응답:
 *   {
 *     total: 518,      // 본인 활성 메모 수
 *     embedded: 412,   // 임베딩 있는 메모 수
 *     missing: 106,    // NULL인 메모 수
 *     percent: 79.5,
 *   }
 */

import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })

    const [{ count: total }, { count: embedded }] = await Promise.all([
      supabase
        .from('memos')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('is_deleted', false),
      supabase
        .from('memos')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('is_deleted', false)
        .not('embedding', 'is', null),
    ])

    const totalN = total ?? 0
    const embeddedN = embedded ?? 0
    const missing = Math.max(0, totalN - embeddedN)
    const percent = totalN > 0 ? Math.round((embeddedN / totalN) * 1000) / 10 : 0

    return Response.json({
      total: totalN,
      embedded: embeddedN,
      missing,
      percent,
    })
  } catch (err) {
    console.error('[embeddings/status]', err)
    return Response.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    )
  }
}
