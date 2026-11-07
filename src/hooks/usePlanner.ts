'use client'

import { useEffect, useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, addDays } from 'date-fns'
import { createClient } from '@/lib/supabase/client'
import { usePlannerStore } from '@/store/plannerStore'
import { setUntilOnRRule } from '@/lib/planner/rrulePresets'
import { safeUpdateOrForce } from '@/lib/db/safeUpdate'
import { writeOrQueue, createPlanOrQueue } from '@/lib/sync/withQueue'
import { makeTempId, isTempId } from '@/lib/sync/queueDB'
import { broadcast } from '@/lib/sync/broadcast'
import {
  planKeys,
  readPlansLocalCache, writePlansLocalCache,
  patchPlanInCaches, addPlanToCaches, removePlanFromCaches, findPlanInCaches,
  setRecurringCompletionInCaches, deleteRecurringCompletionInCaches,
  patchHomeStatsOnPlanCreate, patchHomeStatsOnPlanUpdate, patchHomeStatsOnPlanDelete,
  patchHomeStatsOnPlanReschedule,
} from '@/lib/planner/planCache'
import { isInboxPlan, INBOX_RESET_FIELDS } from '@/lib/planner/inbox'
import { expandRecurringPlans } from '@/lib/planner/expandRecurringPlans'
import { pushPlanUndo, TOAST_MS } from '@/lib/planner/planUndo'
import { reportSaveError } from '@/lib/ui/reportSaveError'
import { markGuideStep } from '@/lib/planner/guide'
import { plainTitle, cleanWikiList } from '@/lib/planner/titleTokens'
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
    wikiLinks: (row.wiki_links as string[] | null) ?? [],
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }
}

/**
 * 현재 캘린더 뷰 상태(월/주/일)를 모두 커버하는 fetch 범위.
 * 구 usePlanner.load()의 범위 계산과 동일 — 쿼리 키 재료로 사용.
 */
export function useCalRange(): { calStart: string; calEnd: string } {
  const currentMonth = usePlannerStore((s) => s.currentMonth)
  const currentWeek = usePlannerStore((s) => s.currentWeek)
  const selectedDate = usePlannerStore((s) => s.selectedDate)

  return useMemo(() => {
    const monthStart = format(startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 0 }), 'yyyy-MM-dd')
    const monthEnd = format(endOfWeek(endOfMonth(currentMonth), { weekStartsOn: 0 }), 'yyyy-MM-dd')
    const weekStart = format(currentWeek, 'yyyy-MM-dd')
    const weekEnd = format(addDays(currentWeek, 6), 'yyyy-MM-dd')
    const dayDate = selectedDate || format(new Date(), 'yyyy-MM-dd')

    const calStart = [monthStart, weekStart, dayDate].sort()[0]
    const calEnd = [monthEnd, weekEnd, dayDate].sort().reverse()[0]
    return { calStart, calEnd }
  }, [currentMonth, currentWeek, selectedDate])
}

/**
 * 플랜 서버 상태 — React Query 단일 출처 (상태 이중화 정리 2단계).
 * 구 plannerStore.plans[] 거울 + zustand persist를 대체한다.
 * LS 캐시(lsPlansCache)를 placeholderData로 사용해 즉시 페인트.
 *
 * 주의: initialData가 아니라 placeholderData여야 한다. LS 캐시는 "마지막으로
 * 실제 fetch한 범위"의 플랜만 담고 있는데, initialData + 최신 ts로 넘기면
 * staleTime(5분) 동안 새 범위 키가 '신선'으로 판정되어 서버 fetch 자체가
 * 생략된다 → 과거 달로 이동해도 그 범위 플랜을 영영 안 불러오는 버그
 * (2026-08 수정). placeholderData는 즉시 페인트만 하고 fetch는 항상 수행한다.
 */
export function usePlansQuery(): { plans: Plan[]; isLoading: boolean } {
  const supabase = createClient()
  const { calStart, calEnd } = useCalRange()

  const { data, isLoading, isPlaceholderData } = useQuery({
    queryKey: planKeys.range(calStart, calEnd),
    queryFn: async (): Promise<Plan[]> => {
      const [{ data: single }, { data: range }, { data: recurring }] = await Promise.all([
        supabase.from('plans').select('*').not('date', 'is', null).gte('date', calStart).lte('date', calEnd),
        supabase.from('plans').select('*').not('start_date', 'is', null).lte('start_date', calEnd).gte('end_date', calStart),
        supabase.from('plans').select('*').or('repeat_type.not.is.null,rrule_str.not.is.null'),
      ])
      const all = [...(single ?? []), ...(range ?? []), ...(recurring ?? [])]
      const unique = all.filter((p, i, arr) => arr.findIndex((q) => q.id === p.id) === i)
      return unique.map(toPlan)
    },
    placeholderData: () => readPlansLocalCache(),
  })

  useEffect(() => {
    // placeholder(LS 스냅샷 재유입)는 저장하지 않는다 — ts만 갱신되어
    // 실제 서버 데이터인 척 신선도가 유지되는 문제 방지.
    if (data && !isPlaceholderData) writePlansLocalCache(data)
  }, [data, isPlaceholderData])

  return { plans: data ?? [], isLoading }
}

/** 반복 플랜 인스턴스 완료/스킵 맵 — `${originalPlanId}_${planDate}` → is_completed */
export function useRecurringCompletionsQuery(): Record<string, boolean> {
  const supabase = createClient()
  const { calStart, calEnd } = useCalRange()

  const { data } = useQuery({
    queryKey: planKeys.completions(calStart, calEnd),
    queryFn: async (): Promise<Record<string, boolean>> => {
      try {
        const { data: completions } = await supabase
          .from('recurring_plan_completions')
          .select('original_plan_id, plan_date, is_completed')
          .gte('plan_date', calStart)
          .lte('plan_date', calEnd)
        const map: Record<string, boolean> = {}
        for (const c of completions ?? []) {
          map[`${c.original_plan_id}_${c.plan_date}`] = c.is_completed
        }
        return map
      } catch {
        return {} // table missing — ignore
      }
    },
  })

  return data ?? {}
}

/**
 * 인박스(시간 미정) 플랜 — 날짜·기간·반복이 모두 없는 행 (lib/planner/inbox.ts 정의와 동일 조건).
 * 캘린더 범위 쿼리와 겹치지 않으므로 별도 키로 관리하고, 뮤테이션은 planCache가 소속을 옮긴다.
 */
export function useInboxQuery(): { plans: Plan[]; isLoading: boolean } {
  const supabase = createClient()
  const { data, isLoading } = useQuery({
    queryKey: planKeys.inbox,
    queryFn: async (): Promise<Plan[]> => {
      const { data: rows, error } = await supabase
        .from('plans')
        .select('*')
        .is('date', null)
        .is('start_date', null)
        .is('repeat_type', null)
        .is('rrule_str', null)
        .order('created_at', { ascending: true })
        .limit(200)
      if (error) throw error
      return (rows ?? []).map(toPlan).filter(isInboxPlan)
    },
  })
  return { plans: data ?? [], isLoading }
}

/**
 * '오늘' 탭 — 지난 미완료(단일일·비반복) + 오늘 플랜 + 오늘의 반복 인스턴스.
 * 기간 플랜은 '오늘 할 일'이 아니라 진행 중인 묶음이라 제외한다(캘린더 종일 레인에 보임).
 */
export function useTodayListQuery(day: string): { overdue: Plan[]; today: Plan[]; isLoading: boolean } {
  const supabase = createClient()
  const { data, isLoading } = useQuery({
    queryKey: planKeys.today(day),
    queryFn: async (): Promise<Plan[]> => {
      const [todayRes, overdueRes, recurringRes, completionsRes] = await Promise.all([
        supabase.from('plans').select('*').eq('date', day).is('repeat_type', null).is('rrule_str', null),
        supabase.from('plans').select('*').lt('date', day).eq('is_completed', false)
          .is('repeat_type', null).is('rrule_str', null)
          .order('date', { ascending: false }).limit(50),
        supabase.from('plans').select('*').or('repeat_type.not.is.null,rrule_str.not.is.null'),
        supabase.from('recurring_plan_completions').select('original_plan_id, plan_date, is_completed').eq('plan_date', day),
      ])
      if (todayRes.error) throw todayRes.error
      if (overdueRes.error) throw overdueRes.error
      if (recurringRes.error) throw recurringRes.error
      // completions 테이블 오류는 '모두 미완료'로 보이는 것보다 재시도가 낫다
      if (completionsRes.error) throw completionsRes.error
      const completions: Record<string, boolean> = {}
      for (const c of completionsRes.data ?? []) completions[`${c.original_plan_id}_${c.plan_date}`] = c.is_completed
      const d = new Date(`${day}T12:00:00`)
      const recurringToday = expandRecurringPlans((recurringRes.data ?? []).map(toPlan), d, d, completions)
        .filter((p) => p.date === day)
      return [...(overdueRes.data ?? []).map(toPlan), ...(todayRes.data ?? []).map(toPlan), ...recurringToday]
    },
  })
  const all = data ?? []
  return {
    overdue: all.filter((p) => !!p.date && p.date < day),
    today: all
      .filter((p) => p.date === day)
      .sort((a, b) => {
        const ka = a.isAllDay || !a.startTime ? '' : a.startTime
        const kb = b.isAllDay || !b.startTime ? '' : b.startTime
        return ka < kb ? -1 : ka > kb ? 1 : 0
      }),
    isLoading,
  }
}

export function usePlanner() {
  const supabase = createClient()
  const queryClient = useQueryClient()

  const invalidateHomeQueries = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['home-stats'] })
    queryClient.invalidateQueries({ queryKey: ['home-dday'] })
    // '오늘' 탭은 소속(지난 미완료 ↔ 오늘 ↔ 다른 날)이 바뀔 수 있어 재조회로 맞춘다
    queryClient.invalidateQueries({ queryKey: planKeys.todayAll })
  }, [queryClient])

  /** Google Calendar 동기화 등 외부 변경 후 전체 재조회 */
  const refresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['plans'] })
  }, [queryClient])

  /**
   * PR-M1-B: 플랜 신규 작성 — online이면 즉시 server insert, offline이면 임시 ID + 큐.
   * 임시 ID로 UI에 먼저 표시 → 큐 flush 시 SyncBootstrap이 swapPlanIdInCaches로 진짜 ID 교체.
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
      wiki_links: cleanWikiList(data.wikiLinks ?? []),
    }
    // 인박스(날짜·기간 없음)는 알릴 시각이 없다 — 알림은 항상 끈다
    if (!fields.date && !fields.start_date) fields.notify_enabled = false

    const result = await createPlanOrQueue(fields, tempId)

    if (result.queued) {
      // offline — 임시 ID로 즉시 표시 (RQ + LS 캐시에 삽입)
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
        wikiLinks: fields.wiki_links,
        createdAt: nowIso,
        updatedAt: nowIso,
      }
      addPlanToCaches(queryClient, tempPlan)
      patchHomeStatsOnPlanCreate(queryClient, tempPlan) // 홈 '이번 주 플랜' 즉시 반영
      // broadcast/home invalidate는 flush 후
      return tempPlan
    }

    const plan = toPlan(result.row!)
    addPlanToCaches(queryClient, plan)
    patchHomeStatsOnPlanCreate(queryClient, plan) // 홈 '이번 주 플랜' 즉시 반영 (invalidate는 백업)
    invalidateHomeQueries()
    broadcast({ type: 'plan-create', plan })
    return plan
  }, [invalidateHomeQueries, queryClient])

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
    if (data.wikiLinks !== undefined) dbPatch.wiki_links = cleanWikiList(data.wikiLinks)

    const original = findPlanInCaches(queryClient, id)
    const knownUpdatedAt = original?.updatedAt ?? new Date().toISOString()

    // PR-M1-A: online이면 직접, offline이면 큐
    const result = await writeOrQueue({
      table: 'plans', recordId: id, patch: dbPatch, knownUpdatedAt,
    })
    // 홈 '이번 주 플랜' 즉시 반영 — isCompleted가 실제로 바뀌면 전체 완료 수도 조정
    const completedDelta: -1 | 0 | 1 =
      data.isCompleted === undefined || !original || data.isCompleted === original.isCompleted
        ? 0 : data.isCompleted ? 1 : -1
    if (data.isCompleted === true) markGuideStep('complete')
    patchHomeStatsOnPlanUpdate(queryClient, id, data, completedDelta)
    if (original && (data.date !== undefined || data.startDate !== undefined || data.endDate !== undefined)) {
      patchHomeStatsOnPlanReschedule(queryClient, { ...original, ...data })
    }
    if (result.queued) {
      const tempUpdatedAt = new Date().toISOString()
      patchPlanInCaches(queryClient, id, { ...data, updatedAt: tempUpdatedAt })
    } else {
      const updated_at = result.updated_at!
      const patchWithTime: Partial<Plan> = { ...data, updatedAt: updated_at }
      patchPlanInCaches(queryClient, id, patchWithTime)
      invalidateHomeQueries()
      broadcast({ type: 'plan-update', id, patch: patchWithTime, updated_at })
    }
  }, [invalidateHomeQueries, queryClient])

  const removePlan = useCallback(async (id: string) => {
    const original = findPlanInCaches(queryClient, id) // 삭제 전 완료 여부 확보
    const { error } = await supabase.from('plans').delete().eq('id', id)
    if (error) throw error // 실패 시 캐시에서 지우지 않음 — 화면에서만 사라지는 착시 방지
    removePlanFromCaches(queryClient, id)
    patchHomeStatsOnPlanDelete(queryClient, id, original?.isCompleted) // 홈 즉시 반영
    invalidateHomeQueries()
    broadcast({ type: 'plan-delete', id })
  }, [invalidateHomeQueries, queryClient])

  const toggleComplete = useCallback(async (id: string, current: boolean) => {
    const original = findPlanInCaches(queryClient, id)
    const knownUpdatedAt = original?.updatedAt ?? new Date().toISOString()

    // PR-M1-A
    const result = await writeOrQueue({
      table: 'plans', recordId: id, patch: { is_completed: !current }, knownUpdatedAt,
    })
    if (!current) markGuideStep('complete')
    // 홈 '이번 주 플랜' 즉시 반영 (완료 수 ±1)
    patchHomeStatsOnPlanUpdate(queryClient, id, { isCompleted: !current }, !current ? 1 : -1)
    if (result.queued) {
      const tempUpdatedAt = new Date().toISOString()
      patchPlanInCaches(queryClient, id, { isCompleted: !current, updatedAt: tempUpdatedAt })
    } else {
      const updated_at = result.updated_at!
      const patch: Partial<Plan> = { isCompleted: !current, updatedAt: updated_at }
      patchPlanInCaches(queryClient, id, patch)
      invalidateHomeQueries()
      broadcast({ type: 'plan-update', id, patch, updated_at })
    }
  }, [invalidateHomeQueries, queryClient])

  const toggleRecurringComplete = useCallback(async (
    originalPlanId: string,
    planDate: string,
    currentlyCompleted: boolean,
  ) => {
    const key = `${originalPlanId}_${planDate}`
    const { data: { session } } = await supabase.auth.getSession(); const user = session?.user ?? null
    if (!user) return
    // supabase-js는 throw하지 않고 { error }를 돌려주므로 직접 확인 — 실패 시 캐시를 바꾸지 않고 throw
    if (currentlyCompleted) {
      const { error } = await supabase.from('recurring_plan_completions')
        .delete()
        .eq('original_plan_id', originalPlanId)
        .eq('plan_date', planDate)
      if (error) throw error
      deleteRecurringCompletionInCaches(queryClient, key)
    } else {
      const { error } = await supabase.from('recurring_plan_completions').upsert({
        user_id: user.id,
        original_plan_id: originalPlanId,
        plan_date: planDate,
        is_completed: true,
      }, { onConflict: 'original_plan_id,plan_date' })
      if (error) throw error
      setRecurringCompletionInCaches(queryClient, key, true)
      markGuideStep('complete')
    }
    invalidateHomeQueries()
    broadcast({ type: 'invalidate', queryKey: ['plans', 'recurring-completions'] })
  }, [invalidateHomeQueries, queryClient])

  const skipRecurringInstance = useCallback(async (
    originalPlanId: string,
    planDate: string,
  ) => {
    const key = `${originalPlanId}_${planDate}`
    const { data: { session } } = await supabase.auth.getSession(); const user = session?.user ?? null
    if (!user) return
    const { error } = await supabase.from('recurring_plan_completions').upsert({
      user_id: user.id,
      original_plan_id: originalPlanId,
      plan_date: planDate,
      is_completed: false,
    }, { onConflict: 'original_plan_id,plan_date' })
    if (error) throw error
    setRecurringCompletionInCaches(queryClient, key, false)
    broadcast({ type: 'invalidate', queryKey: ['plans', 'recurring-completions'] })
  }, [queryClient])

  const stopRecurringFromDate = useCallback(async (
    originalPlanId: string,
    planDate: string,
  ) => {
    const prevDay = new Date(planDate)
    prevDay.setDate(prevDay.getDate() - 1)
    const endDate = prevDay.toISOString().split('T')[0]

    const original = findPlanInCaches(queryClient, originalPlanId)

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
    patchPlanInCaches(queryClient, originalPlanId, localPatch)
    broadcast({ type: 'plan-update', id: originalPlanId, patch: localPatch, updated_at })

    try {
      await supabase.from('recurring_plan_completions')
        .delete()
        .eq('original_plan_id', originalPlanId)
        .gte('plan_date', planDate)
    } catch { /* table missing — ignore */ }
    deleteRecurringCompletionInCaches(queryClient, `${originalPlanId}_${planDate}`)
    broadcast({ type: 'invalidate', queryKey: ['plans', 'recurring-completions'] })
  }, [queryClient])

  /**
   * 일정 정하기 (인박스 → 날짜/시간, 또는 다른 시간으로 이동) + 실행 취소.
   * 되돌리기는 바뀌기 전 값으로 editPlan — 인박스였다면 인박스로 돌아간다.
   */
  const schedulePlan = useCallback(async (
    plan: Plan,
    target: { date: string; startTime: string | null; endTime: string | null; isAllDay: boolean },
    message?: string,
  ) => {
    const before: Partial<Plan> = {
      date: plan.date, startDate: plan.startDate, endDate: plan.endDate,
      startTime: plan.startTime, endTime: plan.endTime, isAllDay: plan.isAllDay,
    }
    await editPlan(plan.id, { ...target, startDate: null, endDate: null })
    if (isInboxPlan(plan)) markGuideStep('schedule')
    const when = target.isAllDay || !target.startTime
      ? `${Number(target.date.slice(5, 7))}/${Number(target.date.slice(8, 10))}`
      : `${Number(target.date.slice(5, 7))}/${Number(target.date.slice(8, 10))} ${target.startTime.slice(0, 5)}`
    pushPlanUndo(message ?? `'${plainTitle(plan.title)}'을(를) ${when}에 넣었어요`, () => editPlan(plan.id, before))
  }, [editPlan])

  /** 인박스로 보내기 — 날짜·시간·반복·알림을 비운다 + 실행 취소 */
  const sendToInbox = useCallback(async (plan: Plan) => {
    const before: Partial<Plan> = {
      date: plan.date, startDate: plan.startDate, endDate: plan.endDate,
      startTime: plan.startTime, endTime: plan.endTime, isAllDay: plan.isAllDay,
      repeatType: plan.repeatType, repeatEndDate: plan.repeatEndDate, rruleStr: plan.rruleStr,
      notifyEnabled: plan.notifyEnabled,
    }
    await editPlan(plan.id, INBOX_RESET_FIELDS)
    pushPlanUndo(`'${plainTitle(plan.title)}'을(를) 인박스로 보냈어요`, () => editPlan(plan.id, before))
  }, [editPlan])

  /**
   * 되돌릴 수 있는 삭제 — 화면에서 먼저 숨기고 토스트 시간이 지나면 서버에서 지운다
   * (templateUndo와 같은 패턴). 다시 만들기 방식은 ID가 바뀌어 메모의 linked_plan_ids가 끊긴다.
   * 확정 전에 페이지를 떠나면 삭제되지 않고 남는다(안전한 쪽).
   */
  const removePlanWithUndo = useCallback((plan: Plan) => {
    // 오프라인에서 만든(아직 서버에 없는) 플랜은 지연 삭제를 할 수 없다 — 기존 즉시 삭제 경로로
    if (isTempId(plan.id)) {
      removePlan(plan.id).catch(reportSaveError('플랜을 삭제하지 못했어요.'))
      return
    }
    const original = findPlanInCaches(queryClient, plan.id) ?? plan
    removePlanFromCaches(queryClient, plan.id)
    patchHomeStatsOnPlanDelete(queryClient, plan.id, original.isCompleted)
    let undone = false
    const timer = setTimeout(async () => {
      if (undone) return
      const { error } = await supabase.from('plans').delete().eq('id', plan.id)
      if (error) {
        addPlanToCaches(queryClient, original)
        patchHomeStatsOnPlanReschedule(queryClient, original)
        reportSaveError('플랜을 삭제하지 못했어요.')(error)
        return
      }
      // 기다리는 동안 재조회(다른 탭·실시간 동기화)로 다시 들어왔을 수 있어 확정 시 한 번 더 지운다
      removePlanFromCaches(queryClient, plan.id)
      invalidateHomeQueries()
      broadcast({ type: 'plan-delete', id: plan.id })
    }, TOAST_MS)
    pushPlanUndo(`'${plainTitle(plan.title)}'을(를) 삭제했어요`, async () => {
      undone = true
      clearTimeout(timer)
      addPlanToCaches(queryClient, original)
      patchHomeStatsOnPlanReschedule(queryClient, original)
      // '오늘' 목록·홈 완료 수는 서버 기준으로 다시 맞춘다 (서버에선 아직 지워지지 않았다)
      invalidateHomeQueries()
    }, { windowMs: TOAST_MS - 300 })
  // eslint-disable-next-line react-hooks/exhaustive-deps -- supabase는 렌더마다 새로 만드는 클라이언트 (다른 콜백과 동일)
  }, [invalidateHomeQueries, queryClient, removePlan])

  return {
    refresh,
    createPlan,
    editPlan,
    schedulePlan,
    sendToInbox,
    removePlanWithUndo,
    removePlan,
    toggleComplete,
    toggleRecurringComplete,
    skipRecurringInstance,
    stopRecurringFromDate,
  }
}
