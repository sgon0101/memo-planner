import { create } from 'zustand'
import { format, startOfWeek } from 'date-fns'

// ─────────────────────────────────────────────────────────────
// 상태 이중화 정리 2단계 (2026-07-04): 플랜 서버 데이터는 React Query 단일 출처.
// 기존 plans[]/expandedPlans/recurringCompletions 거울과 그 액션들
// (setPlans/addPlan/updatePlan/deletePlan/swapPlanId/setExpandedPlans/
//  setRecurringCompletion(s)/deleteRecurringCompletion)은 제거됐다.
//  - 쿼리: hooks/usePlanner.ts (usePlansQuery/useRecurringCompletionsQuery)
//  - 캐시 패치 헬퍼: lib/planner/planCache.ts (RQ + LS 동시)
//  - 반복 전개 파생: hooks/useExpandedPlans.ts
// zustand persist(plans)도 LS 캐시(lsPlansCache) + RQ initialData로 대체.
// 이 스토어에는 순수 캘린더 UI 상태만 남는다.
// ─────────────────────────────────────────────────────────────

interface PlannerStore {
  selectedDate: string
  viewMode: 'month' | 'week' | 'day'
  currentMonth: Date
  currentWeek: Date
  selectDate: (date: string) => void
  setViewMode: (mode: 'month' | 'week' | 'day') => void
  setCurrentMonth: (date: Date) => void
  setCurrentWeek: (date: Date) => void
}

export const usePlannerStore = create<PlannerStore>()((set) => ({
  selectedDate: format(new Date(), 'yyyy-MM-dd'),
  viewMode: 'month',
  currentMonth: new Date(),
  currentWeek: startOfWeek(new Date(), { weekStartsOn: 0 }),
  selectDate: (date) => set({ selectedDate: date }),
  setViewMode: (viewMode) => set({ viewMode }),
  setCurrentMonth: (currentMonth) => set({ currentMonth }),
  setCurrentWeek: (currentWeek) => set({ currentWeek }),
}))
