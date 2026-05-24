/**
 * 클라이언트 알림 스케줄러 (단계 A — 브라우저 Notification + setTimeout)
 *
 * - 페이지가 열려있을 때만 동작 (다음 단계 B에서 web push로 백그라운드 알림 가능)
 * - 다음 24시간 내 시간 지정 플랜에 대해 setTimeout 예약
 * - 종일(시간 지정 X) 플랜은 09:00에 알림 (오늘만)
 * - 반복 인스턴스는 plan_date 기준
 * - 중복 예약 방지: planId_date_startTime을 key로 Map에 저장
 *
 * 동작 모드:
 *  - localStorage `weave-notif-enabled`: '1' | '0'
 *  - localStorage `weave-notif-lead-min`: '0' | '5' | '10' | '30' | '60' (몇 분 전 알림)
 */

import { createClient } from '@/lib/supabase/client'
import { expandRecurringPlans } from '@/lib/planner/expandRecurringPlans'
import type { Plan } from '@/types'

const LS_ENABLED = 'weave-notif-enabled'
const LS_LEAD = 'weave-notif-lead-min'

export const NOTIF_DEFAULT_LEAD_MIN = 10
export const LEAD_OPTIONS = [0, 5, 10, 30, 60] as const

/** 클라이언트 ref — module-level singleton */
const timers = new Map<string, ReturnType<typeof setTimeout>>()
let lastRefresh = 0

export function isNotifSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}

export function getNotifPermission(): NotificationPermission | 'unsupported' {
  if (!isNotifSupported()) return 'unsupported'
  return Notification.permission
}

export function isNotifEnabled(): boolean {
  if (!isNotifSupported()) return false
  if (typeof window === 'undefined') return false
  return localStorage.getItem(LS_ENABLED) === '1'
}

export function setNotifEnabled(v: boolean) {
  if (typeof window === 'undefined') return
  localStorage.setItem(LS_ENABLED, v ? '1' : '0')
  if (!v) clearAllTimers()
}

export function getNotifLead(): number {
  if (typeof window === 'undefined') return NOTIF_DEFAULT_LEAD_MIN
  const raw = localStorage.getItem(LS_LEAD)
  const n = raw ? parseInt(raw, 10) : NOTIF_DEFAULT_LEAD_MIN
  return Number.isFinite(n) ? n : NOTIF_DEFAULT_LEAD_MIN
}

export function setNotifLead(min: number) {
  if (typeof window === 'undefined') return
  localStorage.setItem(LS_LEAD, String(min))
}

export async function requestPermissionIfNeeded(): Promise<NotificationPermission | 'unsupported'> {
  if (!isNotifSupported()) return 'unsupported'
  if (Notification.permission === 'granted' || Notification.permission === 'denied') return Notification.permission
  return await Notification.requestPermission()
}

export function clearAllTimers() {
  for (const t of timers.values()) clearTimeout(t)
  timers.clear()
}

/**
 * 다음 24시간 + 12h 이내의 시간 지정 플랜을 fetch해서 알림 예약
 * 이미 예약된 key는 스킵
 */
export async function refreshScheduled(): Promise<{ scheduled: number; skipped: number }> {
  if (!isNotifEnabled() || getNotifPermission() !== 'granted') {
    clearAllTimers()
    return { scheduled: 0, skipped: 0 }
  }

  // 너무 자주 호출되지 않도록 — 60초 throttle
  const now = Date.now()
  if (now - lastRefresh < 60 * 1000) return { scheduled: 0, skipped: 0 }
  lastRefresh = now

  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { scheduled: 0, skipped: 0 }

  const today = new Date()
  const todayStr = formatDate(today)
  const tomorrow = new Date(today.getTime() + 36 * 60 * 60 * 1000)  // 36h
  const tomorrowStr = formatDate(tomorrow)

  // 단일 + 범위 + 반복 모두 가져오기
  const [{ data: single }, { data: range }, { data: recurring }] = await Promise.all([
    supabase.from('plans').select('*').eq('user_id', user.id).gte('date', todayStr).lte('date', tomorrowStr),
    supabase.from('plans').select('*').eq('user_id', user.id).not('start_date', 'is', null).lte('start_date', tomorrowStr).gte('end_date', todayStr),
    supabase.from('plans').select('*').eq('user_id', user.id).or('repeat_type.not.is.null,rrule_str.not.is.null'),
  ])

  const rows = [...(single ?? []), ...(range ?? []), ...(recurring ?? [])]
  const unique = rows.filter((p, i, arr) => arr.findIndex((q) => q.id === p.id) === i)

  // Plan 형식으로 변환
  const plans: Plan[] = unique.map((row) => ({
    id: row.id,
    userId: row.user_id,
    title: row.title,
    description: row.description ?? '',
    color: row.color ?? '#7F77DD',
    date: row.date ?? null,
    startDate: row.start_date ?? null,
    endDate: row.end_date ?? null,
    startTime: row.start_time ?? null,
    endTime: row.end_time ?? null,
    isAllDay: row.is_all_day ?? true,
    isCompleted: row.is_completed ?? false,
    repeatType: row.repeat_type ?? null,
    repeatEndDate: row.repeat_end_date ?? null,
    rruleStr: row.rrule_str ?? null,
    notifyEnabled: row.notify_enabled ?? false,
    notifyLeadMin: row.notify_lead_min ?? 10,
    ddayTarget: row.dday_target ?? null,
    googleEventId: row.google_event_id ?? null,
    linkedMemoIds: row.linked_memo_ids ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))

  // 반복 전개 (오늘부터 36h)
  const expanded = expandRecurringPlans(plans, today, tomorrow, {})

  let scheduled = 0
  let skipped = 0

  for (const p of expanded) {
    if (p.isCompleted) continue
    if (!p.notifyEnabled) continue  // 알림 OFF인 플랜 skip

    // 시간 결정: 시간 지정이면 startTime, 종일이면 09:00 (오늘만)
    const dateStr = p.date ?? p.startDate
    if (!dateStr) continue

    let fireDate: Date
    if (!p.isAllDay && p.startTime) {
      const [h, m] = p.startTime.split(':').map(Number)
      fireDate = new Date(`${dateStr}T${pad2(h)}:${pad2(m)}:00`)
    } else {
      // 종일 — 오늘인 경우만 (내일 종일은 일단 skip)
      if (dateStr !== todayStr) continue
      fireDate = new Date(`${dateStr}T09:00:00`)
    }

    // lead 분 빼기 — plan별 notifyLeadMin 사용 (없으면 사용자 default 10)
    const leadMin = p.notifyLeadMin ?? 10
    const fireAt = fireDate.getTime() - leadMin * 60 * 1000
    const delay = fireAt - now
    if (delay <= 0) { skipped++; continue }
    if (delay > 24 * 60 * 60 * 1000) { skipped++; continue }  // 24h 이상 미래는 다음 refresh 때

    const key = `${p.originalPlanId ?? p.id}_${dateStr}_${p.startTime ?? 'allday'}`
    if (timers.has(key)) { skipped++; continue }

    const planTitle = p.title
    const timeLabel = p.isAllDay ? '오늘' : `${p.startTime?.slice(0, 5) ?? ''}`
    const body = leadMin > 0
      ? `${timeLabel} — ${leadMin}분 후 시작`
      : `${timeLabel} 시작 시간이에요`

    const t = setTimeout(() => {
      try {
        new Notification(planTitle, {
          body,
          icon: '/icon-192.png',
          badge: '/icon-192.png',
          tag: key,
        })
      } catch { /* 권한 변경 등 */ }
      timers.delete(key)
    }, delay)
    timers.set(key, t)
    scheduled++
  }

  return { scheduled, skipped }
}

export async function showTestNotification(): Promise<boolean> {
  if (getNotifPermission() !== 'granted') return false
  try {
    // 모바일 Chrome 등 SW 등록된 사이트는 new Notification() 직접 호출이 제한됨 (TypeError throw)
    // → ServiceWorkerRegistration.showNotification 우선 사용
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready
      await reg.showNotification('weave 알림 테스트', {
        body: '알림이 정상적으로 표시됩니다 🎉',
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: 'weave-test',
      })
      return true
    }
    // Fallback (SW 미지원 환경)
    new Notification('weave 알림 테스트', {
      body: '알림이 정상적으로 표시됩니다 🎉',
      icon: '/icon-192.png',
    })
    return true
  } catch (err) {
    console.error('[showTestNotification]', err)
    return false
  }
}

function formatDate(d: Date): string {
  const y = d.getFullYear()
  const m = pad2(d.getMonth() + 1)
  const day = pad2(d.getDate())
  return `${y}-${m}-${day}`
}
function pad2(n: number): string { return n < 10 ? `0${n}` : String(n) }
