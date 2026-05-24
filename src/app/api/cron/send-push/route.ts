/**
 * 백그라운드 푸시 발송 Cron (#6-B)
 *
 * GET /api/cron/send-push
 * Authorization: Bearer <CRON_SECRET>
 *
 * 매 5분마다 실행되어:
 *  1. 지금부터 ~15분 후 시작 시간을 가진 시간 지정 플랜(+반복 인스턴스) 조회
 *  2. plan_notifications_sent에 이미 보낸 (plan_id, plan_date) 조합은 skip
 *  3. 그 user의 push_subscriptions에 web-push 발송
 *  4. 만료(410/404)된 subscription은 DB에서 삭제
 *  5. 발송 성공한 (plan_id, plan_date) 기록
 *
 * 알림 시점: 시작 시간 - 10분 (대략) ~ 시작 시간 직전
 *   (5분 cron이라 시작 정확히가 아닌 윈도우로 처리)
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { expandRecurringPlans } from '@/lib/planner/expandRecurringPlans'
import { sendPushTo, type PushSubscriptionRow } from '@/lib/push/server'
import type { Plan } from '@/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface PlanRow {
  id: string
  user_id: string
  title: string
  description: string | null
  color: string
  date: string | null
  start_date: string | null
  end_date: string | null
  start_time: string | null
  end_time: string | null
  is_all_day: boolean
  is_completed: boolean
  repeat_type: 'daily' | 'weekly' | 'monthly' | null
  repeat_end_date: string | null
  rrule_str: string | null
  notify_enabled: boolean | null
  notify_lead_min: number | null
  dday_target: string | null
  google_event_id: string | null
  linked_memo_ids: string[]
  created_at: string
  updated_at: string
}

function rowToPlan(r: PlanRow): Plan {
  return {
    id: r.id,
    userId: r.user_id,
    title: r.title,
    description: r.description ?? '',
    color: r.color ?? '#7F77DD',
    date: r.date ?? null,
    startDate: r.start_date ?? null,
    endDate: r.end_date ?? null,
    startTime: r.start_time ?? null,
    endTime: r.end_time ?? null,
    isAllDay: r.is_all_day ?? true,
    isCompleted: r.is_completed ?? false,
    repeatType: r.repeat_type ?? null,
    repeatEndDate: r.repeat_end_date ?? null,
    rruleStr: r.rrule_str ?? null,
    notifyEnabled: r.notify_enabled ?? false,
    notifyLeadMin: r.notify_lead_min ?? 10,
    ddayTarget: r.dday_target ?? null,
    googleEventId: r.google_event_id ?? null,
    linkedMemoIds: r.linked_memo_ids ?? [],
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }
}

function pad2(n: number): string { return n < 10 ? `0${n}` : String(n) }

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  // 발송 윈도우 — 이제 plan별 notify_lead_min 적용이라 window는 "지금 ~ 지금+10분" (cron 5분 + buffer 5분)
  // 각 candidate에 대해 fireAt = startTime - notify_lead_min 분이 windowStart ~ windowEnd 안에 들어오는지 비교
  const now = new Date()
  const windowStart = now
  const windowEnd = new Date(now.getTime() + 10 * 60 * 1000)

  // 오늘 + 내일 범위 (DST/타임존 안전을 위해 약간 넓게)
  // 60분 전 알림까지 지원하므로 window 끝(now+10분)에서 추가 60분 buffer
  const dayBefore = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const dayAfter = new Date(now.getTime() + 48 * 60 * 60 * 1000)
  const dateBeforeStr = dayBefore.toISOString().slice(0, 10)
  const dateAfterStr = dayAfter.toISOString().slice(0, 10)

  // 1) 시간 지정 + (단일일 또는 반복) 플랜 후보 조회 — notify_enabled=true만
  const { data: rows, error: rowsErr } = await supabase
    .from('plans')
    .select('*')
    .eq('is_all_day', false)
    .eq('is_completed', false)
    .eq('notify_enabled', true)
    .not('start_time', 'is', null)
    .or(`and(date.gte.${dateBeforeStr},date.lte.${dateAfterStr}),repeat_type.not.is.null,rrule_str.not.is.null`)
    .returns<PlanRow[]>()

  if (rowsErr) {
    console.error('[cron/send-push] plans fetch', rowsErr)
    return NextResponse.json({ error: rowsErr.message }, { status: 500 })
  }

  // 2) 반복 전개 — viewStart=dayBefore, viewEnd=dayAfter
  const plansByUser = new Map<string, Plan[]>()
  for (const r of rows ?? []) {
    const list = plansByUser.get(r.user_id) ?? []
    list.push(rowToPlan(r))
    plansByUser.set(r.user_id, list)
  }

  let totalSent = 0
  let totalSkipped = 0
  let totalExpired = 0
  const errors: string[] = []

  for (const [userId, userPlans] of plansByUser) {
    // 반복 인스턴스 전개 (completions 미반영 — cron은 사용자 완료 상태 영향 X. 발송만)
    const expanded = expandRecurringPlans(userPlans, dayBefore, dayAfter, {})

    // 윈도우에 들어오는 인스턴스만 — fireAt = startTime - notify_lead_min 분
    const candidates = expanded.filter((p) => {
      if (!p.startTime || !p.date) return false
      const [h, m] = p.startTime.split(':').map(Number)
      const startAt = new Date(`${p.date}T${pad2(h)}:${pad2(m)}:00`)
      const lead = p.notifyLeadMin ?? 10
      const fireAt = new Date(startAt.getTime() - lead * 60 * 1000)
      return fireAt.getTime() >= windowStart.getTime() && fireAt.getTime() < windowEnd.getTime()
    })

    if (candidates.length === 0) continue

    // 3) 이미 보낸 (plan_id, plan_date) 조회
    const planIds = candidates.map((p) => p.originalPlanId ?? p.id)
    const planDates = candidates.map((p) => p.date!)
    const { data: sentRows } = await supabase
      .from('plan_notifications_sent')
      .select('plan_id, plan_date')
      .eq('user_id', userId)
      .in('plan_id', planIds)
      .in('plan_date', planDates)
    const sentSet = new Set((sentRows ?? []).map((r) => `${r.plan_id}_${r.plan_date}`))

    // 4) 그 user의 subscriptions 조회
    const { data: subs } = await supabase
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth')
      .eq('user_id', userId)
    if (!subs || subs.length === 0) continue

    for (const p of candidates) {
      const originalId = p.originalPlanId ?? p.id
      const key = `${originalId}_${p.date}`
      if (sentSet.has(key)) { totalSkipped++; continue }

      const timeLabel = p.startTime ? p.startTime.slice(0, 5) : ''
      const lead = p.notifyLeadMin ?? 10
      const leadLabel = lead === 0 ? '곧 시작' : `${lead}분 후 시작`
      const payload = {
        title: p.title,
        body: `${timeLabel} — ${leadLabel}`,
        tag: key,
        url: `/planner?date=${p.date}`,
      }

      // 모든 subscription에 발송 + 만료된 것 삭제
      const results = await Promise.allSettled(
        (subs as PushSubscriptionRow[]).map((s) => sendPushTo(s, payload)),
      )
      let anySuccess = false
      for (let i = 0; i < results.length; i++) {
        const res = results[i]
        const sub = subs[i]
        if (res.status === 'fulfilled' && res.value.ok) {
          anySuccess = true
        } else if (res.status === 'fulfilled' && !res.value.ok && res.value.expired) {
          await supabase
            .from('push_subscriptions')
            .delete()
            .eq('user_id', userId)
            .eq('endpoint', sub.endpoint)
          totalExpired++
        } else if (res.status === 'rejected') {
          errors.push(String(res.reason))
        }
      }

      if (anySuccess) {
        // 5) 발송 기록
        await supabase.from('plan_notifications_sent').upsert({
          user_id: userId,
          plan_id: originalId,
          plan_date: p.date!,
        }, { onConflict: 'plan_id,plan_date' })
        totalSent++
      }
    }
  }

  return NextResponse.json({
    sent: totalSent,
    skipped: totalSkipped,
    expiredCleaned: totalExpired,
    errors: errors.slice(0, 5),
  })
}
