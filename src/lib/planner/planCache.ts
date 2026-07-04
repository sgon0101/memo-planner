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

import type { QueryClient } from '@tanstack/react-query'
import { lsPlansCache, lsPlansCacheTs } from '@/lib/cache/lsKeys'
import type { Plan } from '@/types'

export const planKeys = {
  /** 모든 범위 키 prefix — setQueriesData/invalidate용 */
  ranges: ['plans', 'range'] as const,
  range: (calStart: string, calEnd: string) => ['plans', 'range', calStart, calEnd] as const,
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

/* ─── RQ + LS 동시 패치 헬퍼 ─────────────────────────────────────────── */

export function patchPlanInCaches(qc: QueryClient, id: string, patch: Partial<Plan>): void {
  qc.setQueriesData<Plan[]>({ queryKey: planKeys.ranges }, (old) =>
    old?.map((p) => (p.id === id ? { ...p, ...patch } : p)),
  )
  mutatePlansLocalCache((plans) => plans.map((p) => (p.id === id ? { ...p, ...patch } : p)))
}

export function addPlanToCaches(qc: QueryClient, plan: Plan): void {
  qc.setQueriesData<Plan[]>({ queryKey: planKeys.ranges }, (old) =>
    old ? [...old.filter((p) => p.id !== plan.id), plan] : [plan],
  )
  mutatePlansLocalCache((plans) => [...plans.filter((p) => p.id !== plan.id), plan])
}

export function removePlanFromCaches(qc: QueryClient, id: string): void {
  qc.setQueriesData<Plan[]>({ queryKey: planKeys.ranges }, (old) =>
    old?.filter((p) => p.id !== id),
  )
  mutatePlansLocalCache((plans) => plans.filter((p) => p.id !== id))
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
  mutatePlansLocalCache((plans) => plans.map(swap))
}

/** knownUpdatedAt 조회 등 — 모든 범위 캐시에서 탐색, 없으면 LS fallback */
export function findPlanInCaches(qc: QueryClient, id: string): Plan | undefined {
  for (const [, data] of qc.getQueriesData<Plan[]>({ queryKey: planKeys.ranges })) {
    const found = data?.find((p) => p.id === id)
    if (found) return found
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
