/**
 * Web Push subscription 해제 (#6-B)
 *
 * DELETE /api/notifications/unsubscribe
 * body: { endpoint }
 */

import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function DELETE(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })

    const body = (await req.json()) as { endpoint?: string }
    if (!body?.endpoint) {
      return Response.json({ error: 'endpoint required' }, { status: 400 })
    }

    const { error } = await supabase
      .from('push_subscriptions')
      .delete()
      .eq('user_id', user.id)
      .eq('endpoint', body.endpoint)

    if (error) {
      console.error('[push/unsubscribe]', error)
      return Response.json({ error: error.message }, { status: 500 })
    }
    return Response.json({ ok: true })
  } catch (err) {
    console.error('[push/unsubscribe] unexpected', err)
    return Response.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    )
  }
}
