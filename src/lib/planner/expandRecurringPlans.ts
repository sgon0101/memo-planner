import { RRule, rrulestr, type Frequency } from 'rrule'
import type { Plan } from '@/types'

/**
 * RFC 5545 RRULE 기반 반복 플랜 인스턴스 전개.
 *
 * - plan.rruleStr이 있으면 그걸 우선 사용 (예: "FREQ=WEEKLY;BYDAY=MO,WE;INTERVAL=2;UNTIL=20260701T000000Z")
 * - 없으면 legacy plan.repeatType ('daily'|'weekly'|'monthly') + repeatEndDate fallback
 *
 * 타임존 처리: 모든 plan은 'YYYY-MM-DD' plain date로 저장됨.
 * dtstart를 UTC 정오(T12:00:00Z)로 만들어 DST 경계에서 날짜가 어긋나지 않게 함.
 *
 * recurringCompletions[`${originalId}_${date}`]:
 *   undefined = 미완료
 *   true      = 완료
 *   false     = 이 인스턴스만 삭제됨 (달력에서 숨김)
 */
export function expandRecurringPlans(
  plans: Plan[],
  viewStart: Date,
  viewEnd: Date,
  recurringCompletions: Record<string, boolean> = {},
): Plan[] {
  const expanded: Plan[] = []

  // between()에 넘길 UTC 경계 (Date.UTC로 명시적 UTC)
  const rangeStart = new Date(Date.UTC(
    viewStart.getFullYear(), viewStart.getMonth(), viewStart.getDate(),
    0, 0, 0,
  ))
  const rangeEnd = new Date(Date.UTC(
    viewEnd.getFullYear(), viewEnd.getMonth(), viewEnd.getDate(),
    23, 59, 59,
  ))

  for (const plan of plans) {
    const isRecurring = !!(plan.rruleStr || plan.repeatType)
    const baseDateStr = plan.date ?? plan.startDate
    if (!isRecurring || !baseDateStr) {
      expanded.push(plan)
      continue
    }

    const rule = planToRRule(plan, baseDateStr)
    if (!rule) {
      expanded.push(plan)
      continue
    }

    let dates: Date[] = []
    try {
      dates = rule.between(rangeStart, rangeEnd, true)
    } catch {
      // 잘못된 rule 문자열 등 — 인스턴스 없음
      dates = []
    }

    // 안전망: 한 plan에서 500개 이상 인스턴스는 비정상으로 보고 절단
    if (dates.length > 500) dates = dates.slice(0, 500)

    for (const d of dates) {
      const dateStr = toLocalDateStr(d)
      const key = `${plan.id}_${dateStr}`
      const completion = recurringCompletions[key]
      if (completion === false) continue  // 이 인스턴스만 삭제

      expanded.push({
        ...plan,
        id: `${plan.id}_${dateStr}`,
        date: dateStr,
        isCompleted: completion === true,
        isRecurringInstance: true,
        originalPlanId: plan.id,
      })
    }
  }

  return expanded
}

/* ────────────────────────────────────────────────────────── */

const LEGACY_FREQ: Record<string, Frequency> = {
  daily: RRule.DAILY,
  weekly: RRule.WEEKLY,
  monthly: RRule.MONTHLY,
}

function planToRRule(plan: Plan, baseDateStr: string): RRule | null {
  // UTC 정오 — 타임존/DST 영향을 받지 않는 안전 기준점
  const dtstart = new Date(`${baseDateStr}T12:00:00Z`)

  // 1. rrule_str 우선
  if (plan.rruleStr) {
    try {
      const trimmed = plan.rruleStr.trim()
      // 'DTSTART:...\nRRULE:...' 포맷이면 그대로
      if (trimmed.toUpperCase().startsWith('DTSTART')) {
        const parsed = rrulestr(trimmed)
        return parsed instanceof RRule ? parsed : null
      }
      // 'RRULE:...' 또는 'FREQ=...' 만 있는 포맷 → dtstart 옵션 제공
      const normalized = trimmed.toUpperCase().startsWith('RRULE:')
        ? trimmed
        : `RRULE:${trimmed}`
      const parsed = rrulestr(normalized, { dtstart })
      return parsed instanceof RRule ? parsed : null
    } catch {
      // 파싱 실패 → legacy fallback 시도
    }
  }

  // 2. legacy repeat_type
  if (!plan.repeatType) return null
  return new RRule({
    freq: LEGACY_FREQ[plan.repeatType] ?? RRule.DAILY,
    dtstart,
    until: plan.repeatEndDate
      ? new Date(`${plan.repeatEndDate}T23:59:59Z`)
      : undefined,
  })
}

function toLocalDateStr(d: Date): string {
  // dtstart가 UTC 정오라 between도 UTC noon 근방의 시각을 돌려줌.
  // UTC 기준으로 YYYY-MM-DD 추출 (날짜 경계가 안전함).
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth() + 1
  const day = d.getUTCDate()
  return `${y}-${pad2(m)}-${pad2(day)}`
}
function pad2(n: number): string { return n < 10 ? `0${n}` : String(n) }
