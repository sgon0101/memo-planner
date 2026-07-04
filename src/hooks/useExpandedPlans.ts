'use client'

/**
 * 반복 플랜 전개 파생 훅 — 상태 이중화 정리 2단계.
 *
 * 구조 변경: 구 CalendarView가 expandRecurringPlans 결과를
 * plannerStore.expandedPlans에 밀어넣고 PlanPanel이 읽던 이중 파생 미러 제거.
 * 이제 RQ 플랜/완료맵 + 캘린더 UI 상태에서 각 소비처가 직접 파생한다
 * (쿼리는 RQ가 dedupe, useMemo 계산 비용은 뷰 범위라 미미).
 */

import { useMemo } from 'react'
import { parseISO, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays } from 'date-fns'
import { usePlannerStore } from '@/store/plannerStore'
import { usePlansQuery, useRecurringCompletionsQuery } from '@/hooks/usePlanner'
import { expandRecurringPlans } from '@/lib/planner/expandRecurringPlans'
import type { Plan } from '@/types'

export function useExpandedPlans(): {
  plans: Plan[]
  expandedPlans: Plan[]
  recurringCompletions: Record<string, boolean>
  isLoading: boolean
} {
  const currentMonth = usePlannerStore((s) => s.currentMonth)
  const currentWeek = usePlannerStore((s) => s.currentWeek)
  const selectedDate = usePlannerStore((s) => s.selectedDate)

  const { plans, isLoading } = usePlansQuery()
  const recurringCompletions = useRecurringCompletionsQuery()

  const expandedPlans = useMemo(() => {
    const monthStart = startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 0 })
    const monthEnd = endOfWeek(endOfMonth(currentMonth), { weekStartsOn: 0 })
    const weekEnd = addDays(currentWeek, 6)
    const dayDate = selectedDate ? parseISO(selectedDate) : new Date()

    const candidates = [monthStart, currentWeek, dayDate]
    const viewStart = candidates.reduce((a, b) => a < b ? a : b)
    const viewEnd = [monthEnd, weekEnd, dayDate].reduce((a, b) => a > b ? a : b)

    return expandRecurringPlans(plans, viewStart, viewEnd, recurringCompletions)
  }, [plans, recurringCompletions, currentMonth, currentWeek, selectedDate])

  return { plans, expandedPlans, recurringCompletions, isLoading }
}
