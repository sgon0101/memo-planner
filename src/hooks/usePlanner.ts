'use client'

import { useEffect, useCallback } from 'react'
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays } from 'date-fns'
import { createClient } from '@/lib/supabase/client'
import { usePlannerStore } from '@/store/plannerStore'
import { setUntilOnRRule } from '@/lib/planner/rrulePresets'
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
    repeatEndDate: (row.repeat_end_date as string) ?? null,
    rruleStr: (row.rrule_str as string) ?? null,
    notifyEnabled: (row.notify_enabled as boolean) ?? false,
    ddayTarget: (row.dday_target as string) ?? null,
    googleEventId: (row.google_event_id as string) ?? null,
    linkedMemoIds: (row.linked_memo_ids as string[]) ?? [],
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }
}

export function usePlanner() {
  const {
    plans,
    currentMonth, currentWeek, selectedDate,
    setPlans, addPlan, updatePlan, deletePlan,
    setRecurringCompletions, setRecurringCompletion, deleteRecurringCompletion,
  } = usePlannerStore()
  const supabase = createClient()

  const load = useCallback(async () => {
    const monthStart = format(startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 0 }), 'yyyy-MM-dd')
    const monthEnd = format(endOfWeek(endOfMonth(currentMonth), { weekStartsOn: 0 }), 'yyyy-MM-dd')
    const weekStart = format(currentWeek, 'yyyy-MM-dd')
    const weekEnd = format(addDays(currentWeek, 6), 'yyyy-MM-dd')
    const dayDate = selectedDate || format(new Date(), 'yyyy-MM-dd')

    const calStart = [monthStart, weekStart, dayDate].sort()[0]
    const calEnd = [monthEnd, weekEnd, dayDate].sort().reverse()[0]

    const [{ data: single }, { data: range }, { data: recurring }] = await Promise.all([
      supabase.from('plans').select('*').not('date', 'is', null).gte('date', calStart).lte('date', calEnd),
      supabase.from('plans').select('*').not('start_date', 'is', null).lte('start_date', calEnd).gte('end_date', calStart),
      // 반복 플랜: 신규 rrule_str 또는 legacy repeat_type 둘 중 하나라도 있는 것
      supabase.from('plans').select('*').or('repeat_type.not.is.null,rrule_str.not.is.null'),
    ])

    const all = [...(single ?? []), ...(range ?? []), ...(recurring ?? [])]
    const unique = all.filter((p, i, arr) => arr.findIndex((q) => q.id === p.id) === i)
    setPlans(unique.map(toPlan))

    // 반복 플랜 완료 상태 로드 (테이블 없으면 graceful fallback)
    try {
      const { data: completions } = await supabase
        .from('recurring_plan_completions')
        .select('original_plan_id, plan_date, is_completed')
        .gte('plan_date', calStart)
        .lte('plan_date', calEnd)
      if (completions) {
        const map: Record<string, boolean> = {}
        for (const c of completions) {
          map[`${c.original_plan_id}_${c.plan_date}`] = c.is_completed
        }
        setRecurringCompletions(map)
      }
    } catch {
      // recurring_plan_completions 테이블이 없으면 무시
    }
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
        repeat_end_date: data.repeatEndDate ?? null,
        rrule_str: data.rruleStr ?? null,
        notify_enabled: data.notifyEnabled ?? false,
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
      repeat_end_date: data.repeatEndDate,
      rrule_str: data.rruleStr,
      notify_enabled: data.notifyEnabled,
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

  /** 반복 인스턴스 완료 토글
   *  is_completed=false는 "이 인스턴스 숨김(skip)" 의미로 예약되어 있으므로
   *  완료 해제 시에는 row를 delete해서 충돌 방지 (delete = 미완료 상태) */
  const toggleRecurringComplete = useCallback(async (
    originalPlanId: string,
    planDate: string,
    currentlyCompleted: boolean,
  ) => {
    const key = `${originalPlanId}_${planDate}`
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    try {
      if (currentlyCompleted) {
        // 완료 → 해제: row 삭제 (skip 의미와 충돌 방지)
        await supabase.from('recurring_plan_completions')
          .delete()
          .eq('original_plan_id', originalPlanId)
          .eq('plan_date', planDate)
        deleteRecurringCompletion(key)
      } else {
        // 미완료 → 완료: upsert true
        await supabase.from('recurring_plan_completions').upsert({
          user_id: user.id,
          original_plan_id: originalPlanId,
          plan_date: planDate,
          is_completed: true,
        }, { onConflict: 'original_plan_id,plan_date' })
        setRecurringCompletion(key, true)
      }
    } catch {
      // 테이블 없으면 로컬만 업데이트
      if (currentlyCompleted) deleteRecurringCompletion(key)
      else setRecurringCompletion(key, true)
    }
  }, [])

  /** 반복 인스턴스 이 일정만 삭제 (숨김 처리) */
  const skipRecurringInstance = useCallback(async (
    originalPlanId: string,
    planDate: string,
  ) => {
    const key = `${originalPlanId}_${planDate}`
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    try {
      await supabase.from('recurring_plan_completions').upsert({
        user_id: user.id,
        original_plan_id: originalPlanId,
        plan_date: planDate,
        is_completed: false,  // false = 이 일정 숨김
      }, { onConflict: 'original_plan_id,plan_date' })
    } catch { /* 테이블 없으면 무시 */ }
    setRecurringCompletion(key, false)
  }, [])

  /** 이후 모든 일정 삭제: repeat_end_date + rrule_str의 UNTIL을 해당 날짜 하루 전으로 설정.
   *  RRULE 기반 신규 플랜은 expandRecurringPlans가 rrule_str을 우선 사용하므로,
   *  repeat_end_date만 갱신하면 효과가 없음 → rrule_str도 같이 갱신해야 함. */
  const stopRecurringFromDate = useCallback(async (
    originalPlanId: string,
    planDate: string,
  ) => {
    const prevDay = new Date(planDate)
    prevDay.setDate(prevDay.getDate() - 1)
    const endDate = prevDay.toISOString().split('T')[0]

    // 원본 plan 조회 (rrule_str 보유 여부 판정)
    const original = plans.find((p) => p.id === originalPlanId)

    const patch: Record<string, unknown> = { repeat_end_date: endDate }
    let newRrule: string | null = original?.rruleStr ?? null
    if (original?.rruleStr) {
      newRrule = setUntilOnRRule(original.rruleStr, endDate)
      patch.rrule_str = newRrule
    }

    await supabase.from('plans').update(patch).eq('id', originalPlanId)
    updatePlan(originalPlanId, {
      repeatEndDate: endDate,
      ...(original?.rruleStr ? { rruleStr: newRrule } : {}),
    })

    // 이후 날짜의 완료 기록 정리 (있다면)
    try {
      await supabase.from('recurring_plan_completions')
        .delete()
        .eq('original_plan_id', originalPlanId)
        .gte('plan_date', planDate)
    } catch { /* 테이블 없으면 무시 */ }
    // 로컬 completions에서도 정리
    deleteRecurringCompletion(`${originalPlanId}_${planDate}`)
  }, [plans])

  return {
    load,
    createPlan,
    editPlan,
    removePlan,
    toggleComplete,
    toggleRecurringComplete,
    skipRecurringInstance,
    stopRecurringFromDate,
  }
}
