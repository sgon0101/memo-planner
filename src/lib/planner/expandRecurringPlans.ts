import { addDays, addWeeks, addMonths, isBefore, isAfter, parseISO } from 'date-fns'
import type { Plan } from '@/types'

function nextDate(date: Date, repeatType: string): Date {
  if (repeatType === 'daily') return addDays(date, 1)
  if (repeatType === 'weekly') return addWeeks(date, 1)
  if (repeatType === 'monthly') return addMonths(date, 1)
  return addDays(date, 1)
}

/**
 * 반복 플랜을 뷰 범위 내 가상 인스턴스로 전개.
 * recurringCompletions[`${originalId}_${date}`]:
 *   undefined = 미완료 (기본)
 *   true      = 완료
 *   false     = 이 일정 삭제됨 (달력에서 숨김)
 */
export function expandRecurringPlans(
  plans: Plan[],
  viewStart: Date,
  viewEnd: Date,
  recurringCompletions: Record<string, boolean> = {},
): Plan[] {
  const expanded: Plan[] = []

  for (const plan of plans) {
    if (!plan.repeatType || !plan.date) {
      expanded.push(plan)
      continue
    }

    // 반복 종료일 적용
    const repeatEnd = plan.repeatEndDate ? parseISO(plan.repeatEndDate) : null
    const effectiveEnd = repeatEnd && isBefore(repeatEnd, viewEnd) ? repeatEnd : viewEnd

    let cur = parseISO(plan.date)

    // viewStart 이전이면 건너뜀
    while (isBefore(cur, viewStart)) {
      cur = nextDate(cur, plan.repeatType)
      if (repeatEnd && isAfter(cur, repeatEnd)) break
    }

    while (!isAfter(cur, effectiveEnd)) {
      const dateStr = cur.toISOString().split('T')[0]
      const key = `${plan.id}_${dateStr}`
      const completion = recurringCompletions[key]

      // false = 이 일정 삭제됨 → 건너뜀
      if (completion !== false) {
        expanded.push({
          ...plan,
          id: `${plan.id}_${dateStr}`,
          date: dateStr,
          isCompleted: completion === true,
          isRecurringInstance: true,
          originalPlanId: plan.id,
        })
      }

      cur = nextDate(cur, plan.repeatType)
    }
  }

  return expanded
}
