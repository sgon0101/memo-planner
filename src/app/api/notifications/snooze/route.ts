/**
 * 푸시 알림 스누즈 (10분 후 다시)
 *
 * POST /api/notifications/snooze
 * body: { planId, planDate, endpoint }
 *
 * 인증: push_subscriptions.endpoint → user_id 매핑 (Service Role 사용)
 * 효과: plan_notifications_sent에 snoozed_until = now + 10min 저장.
 *   cron이 다음 5분 발화 시 snoozed_until이 과거면 재발사하고 컬럼을 null로 정리.
 */

import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Body {
  planId?: string
  planDate?: string
  endpoint?: string
}

const SNOOZE_MIN = 10

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body
    const { planId, planDate, endpoint } = body
    if (!planId || !planDate || !endpoint) {
      return Response.json({ error: 'missing fields' }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    // endpoint로 user 식별
    const { data: sub, error: subErr } = await supabase
      .from('push_subscriptions')
      .select('user_id')
      .eq('endpoint', endpoint)
      .maybeSingle()
    if (subErr || !sub) {
      return Response.json({ error: 'subscription not found' }, { status: 401 })
    }

    const snoozeUntil = new Date(Date.now() + SNOOZE_MIN * 60 * 1000).toISOString()

    // upsert — 이미 sent된 row 있으면 snoozed_until만 갱신, 없으면 새로 insert
    const { error } = await supabase
      .from('plan_notifications_sent')
      .upsert({
        user_id: sub.user_id,
        plan_id: planId,
        plan_date: planDate,
        snoozed_until: snoozeUntil,
      }, { onConflict: 'plan_id,plan_date' })

    if (error) {
      console.error('[notifications/snooze]', error)
      return Response.json({ error: error.message }, { status: 500 })
    }
    return Response.json({ ok: true, snoozedUntil: snoozeUntil })
  } catch (err) {
    console.error('[notifications/snooze] unexpected', err)
    return Response.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    )
  }
}
