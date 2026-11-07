/**
 * 플랜 React Query 캐시 헬퍼 — 상태 이중화 정리 2단계 (plannerStore).
 *
 * 플랜 서버 상태는 React Query 단일 출처. 쿼리 키가 캘린더 범위별
 * (['plans','range',calStart,calEnd])이므로, 뮤테이션은 setQueriesData로
 * 모든 범위 키를 일괄 패치한다. LS 캐시(lsPlansCache)는 initialData용
 * 즉시 페인트 소스 — RQ 패치와 항상 함께 갱신해 stale 재유입을 막는다.
 *
 * 사용처: hooks/usePlanner.ts(뮤테이션) / useBroadcastListener(멀티탭) /
 *        SyncBootstrap(오프라인 큐 ID swap) / cacheCleanup(give-up 정리)
 */

'use client'

import { startOfWeek, endOfWeek, format } from 'date-fns'
import type { QueryClient } from '@tanstack/react-query'
import { lsPlansCache, lsPlansCacheTs, lsHomeStatsCache, lsHomeStatsCacheTs } from '@/lib/cache/lsKeys'
import { isInboxPlan } from '@/lib/planner/inbox'
import type { Plan } from '@/types'

export const planKeys = {
  /** 모든 범위 키 prefix — setQueriesData/invalidate용 */
  ranges: ['plans', 'range'] as const,
  range: (calStart: string, calEnd: string) => ['plans', 'range', calStart, calEnd] as const,
  /** 인박스(시간 미정) 목록 — 범위 키와 배타적. 일정이 정해지면 ranges로 옮겨진다 */
  inbox: ['plans', 'inbox'] as const,
  /** '오늘' 탭 목록(지난 미완료 + 오늘) prefix — 항목 패치만, 소속 판정은 재조회로 */
  todayAll: ['plans', 'today-list'] as const,
  today: (day: string) => ['plans', 'today-list', day] as const,
  completionsAll: ['plans', 'recurring-completions'] as const,
  completions: (calStart: string, calEnd: string) =>
    ['plans', 'recurring-completions', calStart, calEnd] as const,
}

/* ─── LS 캐시 (useMemos readLocalCache 패턴) ─────────────────────────── */

export function readPlansLocalCache(): Plan[] | undefined {
  if (typeof window === 'undefined') return undefined
  const key = lsPlansCache()
  if (!key) return undefined
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return undefined
    const parsed = JSON.parse(raw) as Plan[]
    return parsed.length > 0 ? parsed : undefined
  } catch {
    return undefined
  }
}

export function readPlansLocalCacheTs(): number {
  if (typeof window === 'undefined') return 0
  const key = lsPlansCacheTs()
  if (!key) return 0
  try {
    const ts = localStorage.getItem(key)
    return ts ? parseInt(ts, 10) : 0
  } catch {
    return 0
  }
}

export function writePlansLocalCache(plans: Plan[]): void {
  if (typeof window === 'undefined') return
  const key = lsPlansCache()
  const tsKey = lsPlansCacheTs()
  if (!key || !tsKey) return
  try {
    localStorage.setItem(key, JSON.stringify(plans))
    localStorage.setItem(tsKey, String(Date.now()))
  } catch { /* quota — ignore */ }
}

/** LS 캐시를 함수로 변형 — 캐시가 없으면 no-op */
function mutatePlansLocalCache(mutate: (plans: Plan[]) => Plan[]): void {
  if (typeof window === 'undefined') return
  const key = lsPlansCache()
  if (!key) return
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return
    const parsed = JSON.parse(raw) as Plan[]
    if (!Array.isArray(parsed)) return
    writePlansLocalCache(mutate(parsed))
  } catch { /* ignore */ }
}

/* ─── RQ + LS 동시 패치 헬퍼 ─────────────────────────────────────────
   2026-11 인박스: 플랜은 ranges(캘린더) 또는 inbox 중 한 곳에만 산다.
   패치 결과로 소속이 바뀌면(인박스 → 날짜 지정, 그 반대) 한쪽에서 빼고
   다른 쪽에 넣는다. '오늘' 탭 목록은 항목만 패치하고 소속은 재조회에 맡긴다. */

function upsert(list: Plan[] | undefined, plan: Plan): Plan[] {
  if (!list) return [plan]
  return list.some((p) => p.id === plan.id)
    ? list.map((p) => (p.id === plan.id ? plan : p))
    : [...list, plan]
}

function placeInRanges(qc: QueryClient, plan: Plan): void {
  // 아직 데이터가 없는(로딩 중) 범위 쿼리에 [plan] 하나만 채워 넣으면 '플랜 1개짜리 달력'이
  // 잠깐 보인다 — 데이터가 있는 캐시만 갱신하고 나머지는 서버 응답을 기다린다
  qc.setQueriesData<Plan[]>({ queryKey: planKeys.ranges }, (old) => (old ? upsert(old, plan) : old))
  mutatePlansLocalCache((plans) => upsert(plans, plan))
}

function dropFromRanges(qc: QueryClient, id: string): void {
  qc.setQueriesData<Plan[]>({ queryKey: planKeys.ranges }, (old) => old?.filter((p) => p.id !== id))
  mutatePlansLocalCache((plans) => plans.filter((p) => p.id !== id))
}

function placeInInbox(qc: QueryClient, plan: Plan): void {
  // 인박스 쿼리가 아직 없으면 만들지 않는다 (다음 마운트 때 서버에서 가져옴)
  qc.setQueriesData<Plan[]>({ queryKey: planKeys.inbox }, (old) => (old ? upsert(old, plan) : old))
}

function dropFromInbox(qc: QueryClient, id: string): void {
  qc.setQueriesData<Plan[]>({ queryKey: planKeys.inbox }, (old) => old?.filter((p) => p.id !== id))
}

function patchTodayLists(qc: QueryClient, id: string, patch: Partial<Plan>): void {
  qc.setQueriesData<Plan[]>({ queryKey: planKeys.todayAll }, (old) =>
    old?.map((p) => (p.id === id ? { ...p, ...patch } : p)),
  )
}

export function patchPlanInCaches(qc: QueryClient, id: string, patch: Partial<Plan>): void {
  const current = findPlanInCaches(qc, id)
  patchTodayLists(qc, id, patch)
  if (!current) {
    // 어느 캐시에도 없으면 있는 곳만 제자리 패치 (구 동작)
    qc.setQueriesData<Plan[]>({ queryKey: planKeys.ranges }, (old) =>
      old?.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    )
    qc.setQueriesData<Plan[]>({ queryKey: planKeys.inbox }, (old) =>
      old?.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    )
    mutatePlansLocalCache((plans) => plans.map((p) => (p.id === id ? { ...p, ...patch } : p)))
    return
  }
  const merged: Plan = { ...current, ...patch }
  if (isInboxPlan(merged)) {
    dropFromRanges(qc, id)
    placeInInbox(qc, merged)
  } else {
    dropFromInbox(qc, id)
    placeInRanges(qc, merged)
  }
}

export function addPlanToCaches(qc: QueryClient, plan: Plan): void {
  if (isInboxPlan(plan)) {
    dropFromRanges(qc, plan.id)
    placeInInbox(qc, plan)
  } else {
    dropFromInbox(qc, plan.id)
    placeInRanges(qc, plan)
  }
}

export function removePlanFromCaches(qc: QueryClient, id: string): void {
  dropFromRanges(qc, id)
  dropFromInbox(qc, id)
  qc.setQueriesData<Plan[]>({ queryKey: planKeys.todayAll }, (old) => old?.filter((p) => p.id !== id))
}

/** 오프라인 큐 flush 후 임시 ID → 진짜 ID 교체 (구 plannerStore.swapPlanId) */
export function swapPlanIdInCaches(
  qc: QueryClient,
  oldId: string,
  newId: string,
  extraPatch?: Partial<Plan>,
): void {
  const swap = (p: Plan): Plan =>
    p.id === oldId ? { ...p, id: newId, ...(extraPatch ?? {}) } : p
  qc.setQueriesData<Plan[]>({ queryKey: planKeys.ranges }, (old) => old?.map(swap))
  qc.setQueriesData<Plan[]>({ queryKey: planKeys.inbox }, (old) => old?.map(swap))
  qc.setQueriesData<Plan[]>({ queryKey: planKeys.todayAll }, (old) => old?.map(swap))
  mutatePlansLocalCache((plans) => plans.map(swap))
}

/** knownUpdatedAt 조회 등 — 범위·인박스·오늘 캐시에서 탐색, 없으면 LS fallback */
export function findPlanInCaches(qc: QueryClient, id: string): Plan | undefined {
  for (const key of [planKeys.ranges, planKeys.inbox, planKeys.todayAll]) {
    for (const [, data] of qc.getQueriesData<Plan[]>({ queryKey: key })) {
      // 반복 인스턴스(가상 행)는 원본이 아니므로 건너뛴다
      const found = data?.find((p) => p.id === id && !p.isRecurringInstance)
      if (found) return found
    }
  }
  return readPlansLocalCache()?.find((p) => p.id === id)
}

/* ─── 반복 완료(recurring completions) 캐시 패치 ─────────────────────── */

export function setRecurringCompletionInCaches(qc: QueryClient, key: string, value: boolean): void {
  qc.setQueriesData<Record<string, boolean>>({ queryKey: planKeys.completionsAll }, (old) =>
    ({ ...(old ?? {}), [key]: value }),
  )
}

export function deleteRecurringCompletionInCaches(qc: QueryClient, key: string): void {
  qc.setQueriesData<Record<string, boolean>>({ queryKey: planKeys.completionsAll }, (old) => {
    if (!old) return old
    const next = { ...old }
    delete next[key]
    return next
  })
}

/* ─── 홈 '이번 주 플랜'(home-stats) 캐시 직접 패치 ────────────────────
   invalidate+refetch에만 의존하면 ①서버 read-after-write lag ②홈 마운트 시
   LS 복원(setQueryData)의 fresh 판정에 밀려 "바로 반영 안 됨" — 뮤테이션이
   RQ 캐시 + LS를 직접 패치해 홈 진입 즉시 최신 상태를 보장한다.
   (invalidate는 서버 정합 백업으로 유지) ─────────────────────────── */

interface HomeWeekPlan {
  id: string
  title: string
  color: string
  date: string | null
  startDate: string | null
  endDate: string | null
  isCompleted: boolean
  isAllDay: boolean
}
interface HomeStats { completedPlans: number; weekPlans: HomeWeekPlan[] }

/** 이번 주(월요일 시작 — home-stats 쿼리와 동일 기준) 포함 여부 */
function isInThisWeek(p: { date: string | null; startDate: string | null; endDate: string | null }): boolean {
  const now = new Date()
  const ws = format(startOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd')
  const we = format(endOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd')
  if (p.date) return p.date >= ws && p.date <= we
  if (p.startDate && p.endDate) return p.startDate <= we && p.endDate >= ws
  return false
}

/** RQ home-stats + LS 캐시를 같은 변형으로 동시 패치 */
function mutateHomeStats(qc: QueryClient, mutate: (s: HomeStats) => HomeStats): void {
  qc.setQueryData<HomeStats | undefined>(['home-stats'], (old) => (old ? mutate(old) : old))
  if (typeof window === 'undefined') return
  try {
    const k = lsHomeStatsCache()
    const kts = lsHomeStatsCacheTs()
    if (!k || !kts) return
    const raw = localStorage.getItem(k)
    if (!raw) return
    localStorage.setItem(k, JSON.stringify(mutate(JSON.parse(raw) as HomeStats)))
    localStorage.setItem(kts, String(Date.now()))
  } catch { /* ignore */ }
}

const sortWeekPlans = (a: HomeWeekPlan, b: HomeWeekPlan) =>
  ((a.date ?? a.startDate) ?? '').localeCompare((b.date ?? b.startDate) ?? '')

/** 플랜 생성 — 이번 주에 해당하면 홈 카드에 즉시 삽입 */
export function patchHomeStatsOnPlanCreate(qc: QueryClient, plan: Plan): void {
  if (!isInThisWeek(plan)) return
  const item: HomeWeekPlan = {
    id: plan.id, title: plan.title, color: plan.color,
    date: plan.date, startDate: plan.startDate, endDate: plan.endDate,
    isCompleted: plan.isCompleted, isAllDay: plan.isAllDay,
  }
  mutateHomeStats(qc, (s) => ({
    ...s,
    weekPlans: [...s.weekPlans.filter((p) => p.id !== item.id), item].sort(sortWeekPlans).slice(0, 10),
  }))
}

/** 플랜 수정/완료 토글 — 홈 카드 항목 패치 + 전체 완료 수 조정 (completedDelta: 완료 상태 변화량) */
export function patchHomeStatsOnPlanUpdate(
  qc: QueryClient,
  id: string,
  patch: Partial<Plan>,
  completedDelta: -1 | 0 | 1 = 0,
): void {
  mutateHomeStats(qc, (s) => ({
    completedPlans: Math.max(0, s.completedPlans + completedDelta),
    weekPlans: s.weekPlans.map((p) =>
      p.id === id
        ? {
            ...p,
            ...(patch.title !== undefined ? { title: patch.title } : {}),
            ...(patch.color !== undefined ? { color: patch.color } : {}),
            ...(patch.date !== undefined ? { date: patch.date } : {}),
            ...(patch.startDate !== undefined ? { startDate: patch.startDate } : {}),
            ...(patch.endDate !== undefined ? { endDate: patch.endDate } : {}),
            ...(patch.isCompleted !== undefined ? { isCompleted: patch.isCompleted } : {}),
            ...(patch.isAllDay !== undefined ? { isAllDay: patch.isAllDay } : {}),
          }
        : p,
    ),
  }))
}

/** 날짜가 바뀐 플랜 — 이번 주로 들어오면 홈 카드에 넣고, 나가면 뺀다
 *  (인박스 → 이번 주 배치, 이번 주 → 다음 주 이동이 홈에 바로 반영되도록) */
export function patchHomeStatsOnPlanReschedule(qc: QueryClient, plan: Plan): void {
  if (isInThisWeek(plan)) {
    patchHomeStatsOnPlanCreate(qc, plan)
  } else {
    mutateHomeStats(qc, (s) => ({ ...s, weekPlans: s.weekPlans.filter((p) => p.id !== plan.id) }))
  }
}

/** 플랜 삭제 — 홈 카드에서 제거 + 완료였다면 전체 완료 수 차감 */
export function patchHomeStatsOnPlanDelete(qc: QueryClient, id: string, wasCompleted?: boolean): void {
  mutateHomeStats(qc, (s) => ({
    completedPlans: wasCompleted ? Math.max(0, s.completedPlans - 1) : s.completedPlans,
    weekPlans: s.weekPlans.filter((p) => p.id !== id),
  }))
}
