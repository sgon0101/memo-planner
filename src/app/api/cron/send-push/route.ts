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
 * 스누즈 처리:
 *  - 사용자가 알림의 "10분 후 다시" 버튼을 누르면 /api/notifications/snooze가
 *    plan_notifications_sent.snoozed_until을 +10min으로 설정.
 *  - cron은 매 발화마다 snoozed_until <= now인 row를 재발사 대상으로 인식하고,
 *    윈도우 밖이어도 후보에 추가해 푸시를 다시 보낸 뒤 컬럼을 null로 정리.
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

  const now = new Date()
  const windowStart = new Date(now.getTime() - 15 * 60 * 1000)
  const windowEnd = new Date(now.getTime() + 10 * 60 * 1000)

  const dayBefore = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const dayAfter = new Date(now.getTime() + 48 * 60 * 60 * 1000)
  const dateBeforeStr = dayBefore.toISOString().slice(0, 10)
  const dateAfterStr = dayAfter.toISOString().slice(0, 10)

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
    const expanded = expandRecurringPlans(userPlans, dayBefore, dayAfter, {})

    // 3) 이 user의 발송/스누즈 기록 전체 조회 (expanded plan 범위)
    const allPlanIds = Array.from(new Set(expanded.map((p) => p.originalPlanId ?? p.id)))
    const allPlanDates = Array.from(
      new Set(expanded.map((p) => p.date).filter((d): d is string => !!d)),
    )
    const sentRows = allPlanIds.length > 0 && allPlanDates.length > 0
      ? (await supabase
          .from('plan_notifications_sent')
          .select('plan_id, plan_date, snoozed_until')
          .eq('user_id', userId)
          .in('plan_id', allPlanIds)
          .in('plan_date', allPlanDates)).data
      : []

    // sentSet: 더 이상 발사하지 말 키 (이미 보냈고 스누즈 없음 / 스누즈 진행 중)
    // snoozeReady: 스누즈가 만료되어 재발사할 키
    const nowMs = Date.now()
    const sentSet = new Set<string>()
    const snoozeReady = new Set<string>()
    for (const r of sentRows ?? []) {
      const k = `${r.plan_id}_${r.plan_date}`
      if (r.snoozed_until) {
        const t = new Date(r.snoozed_until).getTime()
        if (t <= nowMs) snoozeReady.add(k)
        else sentSet.add(k)
      } else {
        sentSet.add(k)
      }
    }

    // 후보: 윈도우 안에 들어온 인스턴스 + 스누즈 만료된 인스턴스(윈도우 밖이어도 재발사)
    const windowCandidates = expanded.filter((p) => {
      if (!p.startTime || !p.date) return false
      const [h, m] = p.startTime.split(':').map(Number)
      const startAt = new Date(`${p.date}T${pad2(h)}:${pad2(m)}:00+09:00`)
      const lead = p.notifyLeadMin ?? 10
      const fireAt = new Date(startAt.getTime() - lead * 60 * 1000)
      return fireAt.getTime() >= windowStart.getTime() && fireAt.getTime() < windowEnd.getTime()
    })
    const windowKeys = new Set(windowCandidates.map((p) => `${p.originalPlanId ?? p.id}_${p.date}`))
    const snoozeExtras: typeof windowCandidates = []
    for (const k of snoozeReady) {
      if (windowKeys.has(k)) continue
      const lastUs = k.lastIndexOf('_')
      const pid = k.slice(0, lastUs)
      const pdate = k.slice(lastUs + 1)
      const extra = expanded.find((p) => (p.originalPlanId ?? p.id) === pid && p.date === pdate)
      if (extra) snoozeExtras.push(extra)
    }
    const candidates = [...windowCandidates, ...snoozeExtras]

    if (candidates.length === 0) continue

    // 4) 그 user의 subscriptions 조회
    const { data: subs } = await supabase
      .from('push_subscriptions')
      .select('endpoint, p256dh, auth')
      .eq('user_id', userId)
    if (!subs || subs.length === 0) continue

    for (const p of candidates) {
      const originalId = p.originalPlanId ?? p.id
      const key = `${originalId}_${p.date}`
      const isSnoozeRefire = snoozeReady.has(key)
      if (sentSet.has(key) && !isSnoozeRefire) { totalSkipped++; continue }

      const timeLabel = p.startTime ? p.startTime.slice(0, 5) : ''
      const lead = p.notifyLeadMin ?? 10
      const leadLabel = lead === 0 ? '곧 시작' : `${lead}분 후 시작`
      const payload = {
        title: isSnoozeRefire ? `🔔 ${p.title}` : p.title,
        body: isSnoozeRefire ? `${timeLabel} — 스누즈 알림` : `${timeLabel} — ${leadLabel}`,
        tag: key,
        url: `/planner?date=${p.date}`,
        // SW가 액션 버튼 처리할 때 필요한 컨텍스트
        data: {
          planId: originalId,
          planDate: p.date,
        },
      }

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
        // 5) 발송 기록 — 스누즈 만료 후 재발사면 snoozed_until 정리
        await supabase.from('plan_notifications_sent').upsert({
          user_id: userId,
          plan_id: originalId,
          plan_date: p.date!,
          snoozed_until: null,
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
