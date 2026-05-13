import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { format, startOfWeek } from 'date-fns'
import type { Plan } from '@/types'

interface PlannerStore {
  plans: Plan[]
  expandedPlans: Plan[]
  recurringCompletions: Record<string, boolean>
  selectedDate: string
  viewMode: 'month' | 'week' | 'day'
  currentMonth: Date
  currentWeek: Date
  setPlans: (plans: Plan[]) => void
  setExpandedPlans: (plans: Plan[]) => void
  setRecurringCompletions: (completions: Record<string, boolean>) => void
  setRecurringCompletion: (key: string, value: boolean) => void
  deleteRecurringCompletion: (key: string) => void
  addPlan: (plan: Plan) => void
  updatePlan: (id: string, patch: Partial<Plan>) => void
  deletePlan: (id: string) => void
  selectDate: (date: string) => void
  setViewMode: (mode: 'month' | 'week' | 'day') => void
  setCurrentMonth: (date: Date) => void
  setCurrentWeek: (date: Date) => void
}

export const usePlannerStore = create<PlannerStore>()(
  persist(
    (set) => ({
      plans: [],
      expandedPlans: [],
      recurringCompletions: {},
      selectedDate: format(new Date(), 'yyyy-MM-dd'),
      viewMode: 'month',
      currentMonth: new Date(),
      currentWeek: startOfWeek(new Date(), { weekStartsOn: 0 }),
      setPlans: (plans) => set({ plans }),
      setExpandedPlans: (expandedPlans) => set({ expandedPlans }),
      setRecurringCompletions: (recurringCompletions) => set({ recurringCompletions }),
      setRecurringCompletion: (key, value) =>
        set((s) => ({ recurringCompletions: { ...s.recurringCompletions, [key]: value } })),
      deleteRecurringCompletion: (key) =>
        set((s) => {
          const next = { ...s.recurringCompletions }
          delete next[key]
          return { recurringCompletions: next }
        }),
      addPlan: (plan) => set((s) => ({ plans: [...s.plans, plan] })),
      updatePlan: (id, patch) =>
        set((s) => ({ plans: s.plans.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),
      deletePlan: (id) => set((s) => ({ plans: s.plans.filter((p) => p.id !== id) })),
      selectDate: (date) => set({ selectedDate: date }),
      setViewMode: (viewMode) => set({ viewMode }),
      setCurrentMonth: (currentMonth) => set({ currentMonth }),
      setCurrentWeek: (currentWeek) => set({ currentWeek }),
    }),
    {
      name: 'planner-store',
      // plans만 persist — expandedPlans는 파생 데이터라 매번 계산
      partialize: (state) => ({ plans: state.plans }),
    }
  )
)
