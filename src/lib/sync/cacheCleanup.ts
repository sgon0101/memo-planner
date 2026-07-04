/**
 * 오프라인 큐 관련 캐시 정리 헬퍼 (PR-M1-B 후속).
 *
 *  - applyIdSwapToLocalStorage : flush 후 임시 ID → 진짜 ID로 LS home/all 캐시도 함께 swap
 *  - removeTempIdsFromCaches   : give-up된 tempId 메모를 zustand/RQ/LS에서 일괄 제거
 *
 * 왜 필요한가:
 *   - SyncBootstrap.applyIdMappings는 React Query 캐시만 swap했었음 → LS는 stale 잔존.
 *   - flushQueue가 give-up하면 tempId 메모는 server엔 영영 없는데 UI엔 그대로 남음.
 */

'use client'

import type { QueryClient } from '@tanstack/react-query'
import { useMemoStore } from '@/store/memoStore'
import { usePlannerStore } from '@/store/plannerStore'
import { lsHomeMemosCache, lsHomeMemosCacheTs, lsMemosCache, lsMemosCacheTs } from '@/lib/cache/lsKeys'
import type { Memo } from '@/types'

/** 임시 ID인지 — queueDB.isTempId와 동일 패턴 (의존 끊기 위해 inline) */
function isTempId(id: string): boolean {
  return id.startsWith('tmp_memo_') || id.startsWith('tmp_plan_')
}

/** LS의 home-memos / memos-all 캐시에서 tempId → realId swap */
export function applyIdSwapToLocalStorage(mappings: Array<{ tempId: string; realId: string }>): void {
  if (typeof window === 'undefined' || mappings.length === 0) return
  const map = new Map(mappings.map((m) => [m.tempId, m.realId]))

  // 홈 캐시 — recentMemos 배열 안 id swap
  const homeKey = lsHomeMemosCache()
  const homeTs = lsHomeMemosCacheTs()
  if (homeKey) {
    try {
      const raw = localStorage.getItem(homeKey)
      if (raw) {
        const parsed = JSON.parse(raw) as { recentMemos?: Array<{ id: string }> }
        if (Array.isArray(parsed.recentMemos)) {
          const next = {
            ...parsed,
            recentMemos: parsed.recentMemos.map((m) => {
              const real = map.get(m.id)
              return real ? { ...m, id: real } : m
            }),
          }
          localStorage.setItem(homeKey, JSON.stringify(next))
          if (homeTs) localStorage.setItem(homeTs, String(Date.now()))
        }
      }
    } catch { /* ignore */ }
  }

  // 전체 메모 캐시 — Memo[] 배열
  const allKey = lsMemosCache()
  const allTs = lsMemosCacheTs()
  if (allKey) {
    try {
      const raw = localStorage.getItem(allKey)
      if (raw) {
        const parsed = JSON.parse(raw) as Memo[]
        if (Array.isArray(parsed)) {
          const next = parsed.map((m) => {
            const real = map.get(m.id)
            return real ? { ...m, id: real } : m
          })
          localStorage.setItem(allKey, JSON.stringify(next))
          if (allTs) localStorage.setItem(allTs, String(Date.now()))
        }
      }
    } catch { /* ignore */ }
  }
}

/**
 * give-up된 tempId들을 zustand store + React Query 캐시 + LS에서 일괄 제거.
 * SyncBootstrap이 flush 결과로 호출 / 다른 탭의 useBroadcastListener도 'queue-giveup' 수신 시 호출.
 */
export function removeTempIdsFromCaches(
  tempIds: string[],
  queryClient: QueryClient,
): void {
  if (tempIds.length === 0) return
  const memoTempIds = tempIds.filter((t) => t.startsWith('tmp_memo_'))
  const planTempIds = tempIds.filter((t) => t.startsWith('tmp_plan_'))

  // zustand — 플랜만 (메모는 React Query 단일 출처)
  const planStore = usePlannerStore.getState()
  for (const t of planTempIds) planStore.deletePlan(t)

  // React Query 캐시
  if (memoTempIds.length > 0) {
    const memoSet = new Set(memoTempIds)
    queryClient.setQueryData<Memo[]>(['memos', 'all', false], (old) =>
      old ? old.filter((m) => !memoSet.has(m.id)) : old,
    )
    queryClient.setQueryData<{ recentMemos: Array<{ id: string }> } | undefined>(
      ['home-memos'],
      (old) => old ? { ...old, recentMemos: old.recentMemos.filter((m) => !memoSet.has(m.id)) } : old,
    )
    queryClient.invalidateQueries({ queryKey: ['home-stats'] })
    queryClient.invalidateQueries({ queryKey: ['memo-folder-counts'] })
  }
  if (planTempIds.length > 0) {
    queryClient.invalidateQueries({ queryKey: ['home-stats'] })
    queryClient.invalidateQueries({ queryKey: ['home-dday'] })
  }

  // LS — home & all 둘 다
  if (typeof window === 'undefined') return
  const homeKey = lsHomeMemosCache()
  const homeTs = lsHomeMemosCacheTs()
  if (homeKey && memoTempIds.length > 0) {
    try {
      const raw = localStorage.getItem(homeKey)
      if (raw) {
        const parsed = JSON.parse(raw) as { recentMemos?: Array<{ id: string }> }
        const memoSet = new Set(memoTempIds)
        if (Array.isArray(parsed.recentMemos)) {
          const next = {
            ...parsed,
            recentMemos: parsed.recentMemos.filter((m) => !memoSet.has(m.id)),
          }
          localStorage.setItem(homeKey, JSON.stringify(next))
          if (homeTs) localStorage.setItem(homeTs, String(Date.now()))
        }
      }
    } catch { /* ignore */ }
  }
  const allKey = lsMemosCache()
  const allTs = lsMemosCacheTs()
  if (allKey && memoTempIds.length > 0) {
    try {
      const raw = localStorage.getItem(allKey)
      if (raw) {
        const parsed = JSON.parse(raw) as Memo[]
        if (Array.isArray(parsed)) {
          const memoSet = new Set(memoTempIds)
          const next = parsed.filter((m) => !memoSet.has(m.id))
          localStorage.setItem(allKey, JSON.stringify(next))
          if (allTs) localStorage.setItem(allTs, String(Date.now()))
        }
      }
    } catch { /* ignore */ }
  }
}

/**
 * PR-M1-C: 이미지 R2 업로드 완료 후 image node attrs swap 신호.
 * - React Query memos all cache는 content를 stripped로 보관 → swap 영향 없음 (LIST_COLS)
 * - home-memos는 미리보기만 → 영향 없음
 * - 현재 에디터에 열린 메모는 MemoEditor가 lastImageSwap을 구독해 Tiptap node attrs 직접 갱신
 *   (기존 currentMemo 갱신 로직은 읽는 곳이 없어 제거 — 상태 이중화 정리)
 */
export function applyImageSwapToCaches(
  mappings: Array<{ localBlobId: string; src: string; srcMd: string | null; srcSm: string | null }>,
  queryClient: QueryClient,
): void {
  if (mappings.length === 0) return

  // MemoEditor가 lastImageSwap 구독해 Tiptap editor의 image node attrs 갱신
  useMemoStore.getState().notifyImageSwap(mappings)

  void queryClient // referenced for future use
}

/** 디버그용 — 미사용 export 방지 */
export { isTempId as _isTempIdInternal }
