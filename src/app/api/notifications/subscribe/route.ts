/**
 * Web Push subscription 등록 (#6-B)
 *
 * POST /api/notifications/subscribe
 * body: { endpoint, keys: { p256dh, auth }, userAgent? }
 *
 * 같은 endpoint가 이미 있으면 upsert (이 user_id에 연결).
 * 다른 user의 endpoint면 user_id로 덮어씀 (브라우저는 보통 1 endpoint = 1 사용자).
 */

import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

interface SubscribeBody {
  endpoint: string
  keys: { p256dh: string; auth: string }
  userAgent?: string
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })

    const body = (await req.json()) as Partial<SubscribeBody>
    if (!body?.endpoint || !body?.keys?.p256dh || !body?.keys?.auth) {
      return Response.json({ error: 'invalid subscription' }, { status: 400 })
    }

    const { error } = await supabase
      .from('push_subscriptions')
      .upsert({
        user_id: user.id,
        endpoint: body.endpoint,
        p256dh: body.keys.p256dh,
        auth: body.keys.auth,
        user_agent: body.userAgent ?? null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,endpoint' })

    if (error) {
      console.error('[push/subscribe]', error)
      return Response.json({ error: error.message }, { status: 500 })
    }
    return Response.json({ ok: true })
  } catch (err) {
    console.error('[push/subscribe] unexpected', err)
    return Response.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    )
  }
}
