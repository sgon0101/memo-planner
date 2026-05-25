/**
 * 푸시 알림 액션 — 플랜 완료 처리
 *
 * POST /api/notifications/complete
 * body: { planId, planDate, endpoint }
 *
 * 인증: push_subscriptions.endpoint → user_id (Service Role)
 * 효과:
 *  - 단일 플랜(plans.date === planDate): plans.is_completed = true
 *  - 반복 인스턴스(plans.date !== planDate): recurring_plan_completions에 upsert
 *  - 플랜의 user_id가 endpoint 소유자와 일치하는지 검증 (다른 사용자 플랜 변조 차단)
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

    const { data: sub, error: subErr } = await supabase
      .from('push_subscriptions')
      .select('user_id')
      .eq('endpoint', endpoint)
      .maybeSingle()
    if (subErr || !sub) {
      return Response.json({ error: 'subscription not found' }, { status: 401 })
    }

    // 플랜 조회 + 소유권 검증
    const { data: plan, error: planErr } = await supabase
      .from('plans')
      .select('id, user_id, date, repeat_type, rrule_str')
      .eq('id', planId)
      .maybeSingle()
    if (planErr || !plan) {
      return Response.json({ error: 'plan not found' }, { status: 404 })
    }
    if (plan.user_id !== sub.user_id) {
      return Response.json({ error: 'forbidden' }, { status: 403 })
    }

    const isRecurring = !!(plan.repeat_type || plan.rrule_str)
    const isSingleInstanceMatch = plan.date === planDate

    if (isRecurring && !isSingleInstanceMatch) {
      // 반복 인스턴스 — recurring_plan_completions에 완료 기록
      const { error } = await supabase
        .from('recurring_plan_completions')
        .upsert({
          user_id: sub.user_id,
          original_plan_id: planId,
          plan_date: planDate,
          is_completed: true,
        }, { onConflict: 'original_plan_id,plan_date' })
      if (error) {
        console.error('[notifications/complete] recurring', error)
        return Response.json({ error: error.message }, { status: 500 })
      }
    } else {
      // 단일 플랜 — plans.is_completed = true
      const { error } = await supabase
        .from('plans')
        .update({ is_completed: true })
        .eq('id', planId)
      if (error) {
        console.error('[notifications/complete] single', error)
        return Response.json({ error: error.message }, { status: 500 })
      }
    }

    return Response.json({ ok: true, recurring: isRecurring && !isSingleInstanceMatch })
  } catch (err) {
    console.error('[notifications/complete] unexpected', err)
    return Response.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 },
    )
  }
}
