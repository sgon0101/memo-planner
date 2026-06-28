/**
 * 동기화 인프라 부팅 (PR-4 + PR-M1-A 통합).
 *
 * (main) layout에서 한 번만 마운트.
 *  1. initCurrentUser  : userId 캐싱 + auth 변경 시 LS namespace 청소
 *  2. useBroadcastListener : 같은 브라우저 멀티탭 동기화
 *  3. useRealtimeSync : Supabase Realtime 디바이스 간 동기화 (사용자 토글)
 *  4. PR-M1-A: online 복귀 시 자동 flushQueue + 주기적 retry
 */

'use client'

import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { initCurrentUser } from '@/lib/auth/currentUser'
import { useBroadcastListener } from '@/hooks/useBroadcastListener'
import { useRealtimeSync } from '@/hooks/useRealtimeSync'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { flushQueue, type FlushResult } from '@/lib/sync/withQueue'
import { useMemoStore } from '@/store/memoStore'
import { usePlannerStore } from '@/store/plannerStore'
import { broadcast } from '@/lib/sync/broadcast'
import { applyIdSwapToLocalStorage, removeTempIdsFromCaches } from '@/lib/sync/cacheCleanup'
import { toast } from '@/components/ui/Toast'
import type { Memo } from '@/types'

const RETRY_INTERVAL_MS = 30_000  // 30초마다 큐 잔여 retry

/**
 * PR-M1-B: flush 후 임시 ID → 진짜 ID 교체.
 * - zustand store (memos / plans)에서 swap
 * - React Query 캐시(memos all)도 swap
 * - broadcast로 다른 탭에 invalidate 신호 (실서버 데이터는 새로 fetch가 정확)
 */
function applyIdMappings(
  mappings: FlushResult['idMappings'],
  queryClient: ReturnType<typeof useQueryClient>,
) {
  if (mappings.length === 0) return
  const memoSwap = useMemoStore.getState().swapId
  const planSwap = usePlannerStore.getState().swapPlanId
  for (const { tempId, realId } of mappings) {
    if (tempId.startsWith('tmp_memo_')) {
      memoSwap(tempId, realId)
      // React Query 캐시 — memos all list
      queryClient.setQueryData<Memo[]>(['memos', 'all', false], (old) =>
        old ? old.map((m) => (m.id === tempId ? { ...m, id: realId } : m)) : old,
      )
      // PR-M1-B 후속: home-memos 캐시도 함께 swap (stale tempId 노출 방지)
      queryClient.setQueryData<{ recentMemos: Array<{ id: string }> } | undefined>(
        ['home-memos'],
        (old) => old
          ? { ...old, recentMemos: old.recentMemos.map((m) => m.id === tempId ? { ...m, id: realId } : m) }
          : old,
      )
      // 현재 URL이 임시 ID로 열려 있으면 진짜 ID로 silent 교체 (재마운트 X)
      if (typeof window !== 'undefined') {
        const path = window.location.pathname
        if (path === `/memo/${tempId}` || path.startsWith(`/memo/${tempId}/`)) {
          const newPath = path.replace(tempId, realId) + window.location.search + window.location.hash
          window.history.replaceState(null, '', newPath)
        }
      }
    } else if (tempId.startsWith('tmp_plan_')) {
      planSwap(tempId, realId)
    }
  }
  // PR-M1-B 후속: LS 캐시도 swap — RQ initialData가 다음 마운트에서 stale tempId를 다시 끌어오는 경로 차단
  applyIdSwapToLocalStorage(mappings)
  // home cache + plans 등은 invalidate로 새로 fetch
  queryClient.invalidateQueries({ queryKey: ['home-memos'] })
  queryClient.invalidateQueries({ queryKey: ['home-stats'] })
  queryClient.invalidateQueries({ queryKey: ['home-dday'] })
  // 다른 탭에도 신호
  broadcast({ type: 'invalidate', queryKey: ['memos', 'all', false] })
  broadcast({ type: 'invalidate', queryKey: ['plans'] })
}

/**
 * PR-M1-B 후속: flush가 영구 실패로 give-up한 tempId 메모를 모든 캐시에서 일괄 제거 + 사용자 알림.
 */
function applyGaveUp(
  entries: FlushResult['gaveUpEntries'],
  queryClient: ReturnType<typeof useQueryClient>,
) {
  if (entries.length === 0) return
  const tempIds = entries.map((e) => e.tempId).filter((x): x is string => !!x)
  if (tempIds.length === 0) return
  removeTempIdsFromCaches(tempIds, queryClient)
  // 다른 탭에도 신호 — useBroadcastListener의 'queue-giveup'이 같은 cleanup 실행
  broadcast({ type: 'queue-giveup', tempIds })
  // 사용자에게 1회 알림
  const memoCount = tempIds.filter((t) => t.startsWith('tmp_memo_')).length
  const planCount = tempIds.filter((t) => t.startsWith('tmp_plan_')).length
  const parts: string[] = []
  if (memoCount > 0) parts.push(`메모 ${memoCount}건`)
  if (planCount > 0) parts.push(`플랜 ${planCount}건`)
  if (parts.length > 0) {
    toast.warning(`${parts.join(' · ')}을 동기화하지 못해 임시 항목을 정리했어요.`)
  }
}

export function SyncBootstrap() {
  const queryClient = useQueryClient()

  useEffect(() => {
    const supabase = createClient()
    void initCurrentUser(supabase)
  }, [])

  useBroadcastListener()
  useRealtimeSync()

  // PR-M1-A + B: online 상태 변경 시 + 주기적 큐 flush, 결과의 idMappings 처리
  const online = useOnlineStatus()
  useEffect(() => {
    if (!online) return
    const runFlush = () => {
      flushQueue()
        .then((result) => {
          applyIdMappings(result.idMappings, queryClient)
          applyGaveUp(result.gaveUpEntries, queryClient)
        })
        .catch(() => {})
    }
    runFlush()  // online 복귀 즉시
    const id = setInterval(runFlush, RETRY_INTERVAL_MS)
    return () => clearInterval(id)
  }, [online, queryClient])

  return null
}
