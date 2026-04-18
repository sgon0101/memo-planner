import { create } from 'zustand'
import { format, startOfWeek } from 'date-fns'
import type { Plan } from '@/types'

interface PlannerStore {
  plans: Plan[]
  selectedDate: string
  viewMode: 'month' | 'week' | 'day'
  currentMonth: Date
  currentWeek: Date
  setPlans: (plans: Plan[]) => void
  addPlan: (plan: Plan) => void
  updatePlan: (id: string, patch: Partial<Plan>) => void
  deletePlan: (id: string) => void
  selectDate: (date: string) => void
  setViewMode: (mode: 'month' | 'week' | 'day') => void
  setCurrentMonth: (date: Date) => void
  setCurrentWeek: (date: Date) => void
}

export const usePlannerStore = create<PlannerStore>((set) => ({
  plans: [],
  selectedDate: format(new Date(), 'yyyy-MM-dd'),
  viewMode: 'month',
  currentMonth: new Date(),
  currentWeek: startOfWeek(new Date(), { weekStartsOn: 0 }),
  setPlans: (plans) => set({ plans }),
  addPlan: (plan) => set((s) => ({ plans: [...s.plans, plan] })),
  updatePlan: (id, patch) =>
    set((s) => ({ plans: s.plans.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),
  deletePlan: (id) => set((s) => ({ plans: s.plans.filter((p) => p.id !== id) })),
  selectDate: (date) => set({ selectedDate: date }),
  setViewMode: (viewMode) => set({ viewMode }),
  setCurrentMonth: (currentMonth) => set({ currentMonth }),
  setCurrentWeek: (currentWeek) => set({ currentWeek }),
}))
