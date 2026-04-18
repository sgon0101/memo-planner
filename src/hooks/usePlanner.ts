'use client'

import { useEffect, useCallback } from 'react'
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays, parseISO } from 'date-fns'
import { createClient } from '@/lib/supabase/client'
import { usePlannerStore } from '@/store/plannerStore'
import type { Plan } from '@/types'

export function toPlan(row: Record<string, unknown>): Plan {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    title: row.title as string,
    description: (row.description as string) ?? '',
    color: (row.color as string) ?? '#7F77DD',
    date: (row.date as string) ?? null,
    startDate: (row.start_date as string) ?? null,
    endDate: (row.end_date as string) ?? null,
    startTime: (row.start_time as string) ?? null,
    endTime: (row.end_time as string) ?? null,
    isAllDay: (row.is_all_day as boolean) ?? true,
    isCompleted: (row.is_completed as boolean) ?? false,
    repeatType: (row.repeat_type as 'daily' | 'weekly' | 'monthly' | null) ?? null,
    ddayTarget: (row.dday_target as string) ?? null,
    googleEventId: (row.google_event_id as string) ?? null,
    linkedMemoIds: (row.linked_memo_ids as string[]) ?? [],
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }
}

export function usePlanner() {
  const { currentMonth, currentWeek, selectedDate, setPlans, addPlan, updatePlan, deletePlan } = usePlannerStore()
  const supabase = createClient()

  const load = useCallback(async () => {
    // 월 뷰 범위
    const monthStart = format(startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 0 }), 'yyyy-MM-dd')
    const monthEnd = format(endOfWeek(endOfMonth(currentMonth), { weekStartsOn: 0 }), 'yyyy-MM-dd')
    // 주 뷰 범위
    const weekStart = format(currentWeek, 'yyyy-MM-dd')
    const weekEnd = format(addDays(currentWeek, 6), 'yyyy-MM-dd')
    // 일 뷰 날짜
    const dayDate = selectedDate || format(new Date(), 'yyyy-MM-dd')

    // 전체 범위: 세 범위의 min/max
    const calStart = [monthStart, weekStart, dayDate].sort()[0]
    const calEnd = [monthEnd, weekEnd, dayDate].sort().reverse()[0]

    // 단일일 플랜
    const { data: single } = await supabase
      .from('plans')
      .select('*')
      .not('date', 'is', null)
      .gte('date', calStart)
      .lte('date', calEnd)

    // 범위 플랜 (달력 범위와 겹치는 것)
    const { data: range } = await supabase
      .from('plans')
      .select('*')
      .not('start_date', 'is', null)
      .lte('start_date', calEnd)
      .gte('end_date', calStart)

    const all = [...(single ?? []), ...(range ?? [])]
    // 중복 제거
    const unique = all.filter((p, i, arr) => arr.findIndex((q) => q.id === p.id) === i)
    setPlans(unique.map(toPlan))
  }, [currentMonth, currentWeek, selectedDate])

  useEffect(() => { load() }, [load])

  const createPlan = useCallback(async (data: Partial<Plan>) => {
    const { data: { user } } = await supabase.auth.getUser()
    const { data: row, error } = await supabase
      .from('plans')
      .insert({
        user_id: user?.id,
        title: data.title ?? '새 플랜',
        description: data.description ?? '',
        color: data.color ?? '#7F77DD',
        date: data.date ?? null,
        start_date: data.startDate ?? null,
        end_date: data.endDate ?? null,
        start_time: data.startTime ?? null,
        end_time: data.endTime ?? null,
        is_all_day: data.isAllDay ?? true,
        repeat_type: data.repeatType ?? null,
        dday_target: data.ddayTarget ?? null,
        linked_memo_ids: data.linkedMemoIds ?? [],
      })
      .select()
      .single()
    if (error) throw error
    const plan = toPlan(row)
    addPlan(plan)
    return plan
  }, [])

  const editPlan = useCallback(async (id: string, data: Partial<Plan>) => {
    const patch: Record<string, unknown> = {
      title: data.title,
      description: data.description,
      color: data.color,
      date: data.date,
      start_date: data.startDate,
      end_date: data.endDate,
      start_time: data.startTime,
      end_time: data.endTime,
      is_all_day: data.isAllDay,
      is_completed: data.isCompleted,
      repeat_type: data.repeatType,
      dday_target: data.ddayTarget,
    }
    if (data.linkedMemoIds !== undefined) patch.linked_memo_ids = data.linkedMemoIds
    await supabase.from('plans').update(patch).eq('id', id)
    updatePlan(id, data)
  }, [])

  const removePlan = useCallback(async (id: string) => {
    await supabase.from('plans').delete().eq('id', id)
    deletePlan(id)
  }, [])

  const toggleComplete = useCallback(async (id: string, current: boolean) => {
    await supabase.from('plans').update({ is_completed: !current }).eq('id', id)
    updatePlan(id, { isCompleted: !current })
  }, [])

  return { load, createPlan, editPlan, removePlan, toggleComplete }
}
