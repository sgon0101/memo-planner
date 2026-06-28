'use client'

import { useEffect, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays } from 'date-fns'
import { createClient } from '@/lib/supabase/client'
import { usePlannerStore } from '@/store/plannerStore'
import { setUntilOnRRule } from '@/lib/planner/rrulePresets'
import { safeUpdateOrForce } from '@/lib/db/safeUpdate'
import { writeOrQueue, createPlanOrQueue } from '@/lib/sync/withQueue'
import { makeTempId } from '@/lib/sync/queueDB'
import { broadcast } from '@/lib/sync/broadcast'
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
    notifyLeadMin: (row.notify_lead_min as number) ?? 10,
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
  const queryClient = useQueryClient()

  const invalidateHomeQueries = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['home-stats'] })
    queryClient.invalidateQueries({ queryKey: ['home-dday'] })
  }, [queryClient])

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
      supabase.from('plans').select('*').or('repeat_type.not.is.null,rrule_str.not.is.null'),
    ])

    const all = [...(single ?? []), ...(range ?? []), ...(recurring ?? [])]
    const unique = all.filter((p, i, arr) => arr.findIndex((q) => q.id === p.id) === i)
    setPlans(unique.map(toPlan))

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
    } catch { /* table missing — ignore */ }
  }, [currentMonth, currentWeek, selectedDate])

  useEffect(() => { load() }, [load])

  /**
   * PR-M1-B: 플랜 신규 작성 — online이면 즉시 server insert, offline이면 임시 ID + 큐.
   * 임시 ID로 UI에 먼저 표시 → 큐 flush 시 SyncBootstrap이 swapPlanId로 진짜 ID 교체.
   *
   * PR-M1-B 핫픽스: getUser→getSession (offline에서 토큰 refresh fail로 user_id=''가 큐에 들어가던 버그)
   */
  const createPlan = useCallback(async (data: Partial<Plan>) => {
    const { data: { session } } = await supabase.auth.getSession()
    const userId = session?.user?.id
    if (!userId) {
      throw new Error('로그인 세션이 만료되었어요. 다시 로그인해주세요.')
    }
    const tempId = makeTempId('plan')
    const nowIso = new Date().toISOString()

    const fields = {
      user_id: userId,
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
      notify_lead_min: data.notifyLeadMin ?? 10,
      dday_target: data.ddayTarget ?? null,
      linked_memo_ids: data.linkedMemoIds ?? [],
    }

    const result = await createPlanOrQueue(fields, tempId)

    if (result.queued) {
      // offline — 임시 ID로 즉시 표시
      const tempPlan: Plan = {
        id: tempId,
        userId,
        title: fields.title,
        description: fields.description,
        color: fields.color,
        date: fields.date,
        startDate: fields.start_date,
        endDate: fields.end_date,
        startTime: fields.start_time,
        endTime: fields.end_time,
        isAllDay: fields.is_all_day,
        isCompleted: false,
        repeatType: fields.repeat_type,
        repeatEndDate: fields.repeat_end_date,
        rruleStr: fields.rrule_str,
        notifyEnabled: fields.notify_enabled,
        notifyLeadMin: fields.notify_lead_min,
        ddayTarget: fields.dday_target,
        googleEventId: null,
        linkedMemoIds: fields.linked_memo_ids,
        createdAt: nowIso,
        updatedAt: nowIso,
      }
      addPlan(tempPlan)
      // broadcast/home invalidate는 flush 후
      return tempPlan
    }

    const plan = toPlan(result.row!)
    addPlan(plan)
    invalidateHomeQueries()
    broadcast({ type: 'plan-create', plan })
    return plan
  }, [invalidateHomeQueries])

  /** Silent + auto-force update — last-write-wins, broadcast 자동 */
  const editPlan = useCallback(async (id: string, data: Partial<Plan>) => {
    const dbPatch: Record<string, unknown> = {
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
      notify_lead_min: data.notifyLeadMin,
      dday_target: data.ddayTarget,
    }
    if (data.linkedMemoIds !== undefined) dbPatch.linked_memo_ids = data.linkedMemoIds

    const original = usePlannerStore.getState().plans.find((p) => p.id === id)
    const knownUpdatedAt = original?.updatedAt ?? new Date().toISOString()

    // PR-M1-A: online이면 직접, offline이면 큐
    const result = await writeOrQueue({
      table: 'plans', recordId: id, patch: dbPatch, knownUpdatedAt,
    })
    if (result.queued) {
      const tempUpdatedAt = new Date().toISOString()
      updatePlan(id, { ...data, updatedAt: tempUpdatedAt })
    } else {
      const updated_at = result.updated_at!
      const patchWithTime: Partial<Plan> = { ...data, updatedAt: updated_at }
      updatePlan(id, patchWithTime)
      invalidateHomeQueries()
      broadcast({ type: 'plan-update', id, patch: patchWithTime, updated_at })
    }
  }, [invalidateHomeQueries])

  const removePlan = useCallback(async (id: string) => {
    await supabase.from('plans').delete().eq('id', id)
    deletePlan(id)
    invalidateHomeQueries()
    broadcast({ type: 'plan-delete', id })
  }, [invalidateHomeQueries])

  const toggleComplete = useCallback(async (id: string, current: boolean) => {
    const original = usePlannerStore.getState().plans.find((p) => p.id === id)
    const knownUpdatedAt = original?.updatedAt ?? new Date().toISOString()

    // PR-M1-A
    const result = await writeOrQueue({
      table: 'plans', recordId: id, patch: { is_completed: !current }, knownUpdatedAt,
    })
    if (result.queued) {
      const tempUpdatedAt = new Date().toISOString()
      updatePlan(id, { isCompleted: !current, updatedAt: tempUpdatedAt })
    } else {
      const updated_at = result.updated_at!
      const patch: Partial<Plan> = { isCompleted: !current, updatedAt: updated_at }
      updatePlan(id, patch)
      invalidateHomeQueries()
      broadcast({ type: 'plan-update', id, patch, updated_at })
    }
  }, [invalidateHomeQueries])

  const toggleRecurringComplete = useCallback(async (
    originalPlanId: string,
    planDate: string,
    currentlyCompleted: boolean,
  ) => {
    const key = `${originalPlanId}_${planDate}`
    const { data: { session } } = await supabase.auth.getSession(); const user = session?.user ?? null
    if (!user) return
    try {
      if (currentlyCompleted) {
        await supabase.from('recurring_plan_completions')
          .delete()
          .eq('original_plan_id', originalPlanId)
          .eq('plan_date', planDate)
        deleteRecurringCompletion(key)
      } else {
        await supabase.from('recurring_plan_completions').upsert({
          user_id: user.id,
          original_plan_id: originalPlanId,
          plan_date: planDate,
          is_completed: true,
        }, { onConflict: 'original_plan_id,plan_date' })
        setRecurringCompletion(key, true)
      }
    } catch {
      if (currentlyCompleted) deleteRecurringCompletion(key)
      else setRecurringCompletion(key, true)
    }
    invalidateHomeQueries()
    broadcast({ type: 'invalidate', queryKey: ['plans', 'recurring-completions'] })
  }, [invalidateHomeQueries])

  const skipRecurringInstance = useCallback(async (
    originalPlanId: string,
    planDate: string,
  ) => {
    const key = `${originalPlanId}_${planDate}`
    const { data: { session } } = await supabase.auth.getSession(); const user = session?.user ?? null
    if (!user) return
    try {
      await supabase.from('recurring_plan_completions').upsert({
        user_id: user.id,
        original_plan_id: originalPlanId,
        plan_date: planDate,
        is_completed: false,
      }, { onConflict: 'original_plan_id,plan_date' })
    } catch { /* table missing — ignore */ }
    setRecurringCompletion(key, false)
    broadcast({ type: 'invalidate', queryKey: ['plans', 'recurring-completions'] })
  }, [])

  const stopRecurringFromDate = useCallback(async (
    originalPlanId: string,
    planDate: string,
  ) => {
    const prevDay = new Date(planDate)
    prevDay.setDate(prevDay.getDate() - 1)
    const endDate = prevDay.toISOString().split('T')[0]

    const original = plans.find((p) => p.id === originalPlanId)

    const patch: Record<string, unknown> = { repeat_end_date: endDate }
    let newRrule: string | null = original?.rruleStr ?? null
    if (original?.rruleStr) {
      newRrule = setUntilOnRRule(original.rruleStr, endDate)
      patch.rrule_str = newRrule
    }

    const knownUpdatedAt = original?.updatedAt ?? new Date().toISOString()
    const { updated_at } = await safeUpdateOrForce(
      { table: 'plans', id: originalPlanId, patch, knownUpdatedAt },
      () => console.warn('[weave:conflict] plans stopRecurringFromDate', originalPlanId),
    )

    const localPatch: Partial<Plan> = {
      repeatEndDate: endDate,
      updatedAt: updated_at,
      ...(original?.rruleStr ? { rruleStr: newRrule } : {}),
    }
    updatePlan(originalPlanId, localPatch)
    broadcast({ type: 'plan-update', id: originalPlanId, patch: localPatch, updated_at })

    try {
      await supabase.from('recurring_plan_completions')
        .delete()
        .eq('original_plan_id', originalPlanId)
        .gte('plan_date', planDate)
    } catch { /* table missing — ignore */ }
    deleteRecurringCompletion(`${originalPlanId}_${planDate}`)
    broadcast({ type: 'invalidate', queryKey: ['plans', 'recurring-completions'] })
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
