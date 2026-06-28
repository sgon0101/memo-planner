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
      // React Query 캐시 — memos all list만 (다른 키는 fetch가 진실)
      queryClient.setQueryData<Memo[]>(['memos', 'all', false], (old) =>
        old ? old.map((m) => (m.id === tempId ? { ...m, id: realId } : m)) : old,
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
  // home cache + plans 등은 invalidate로 새로 fetch
  queryClient.invalidateQueries({ queryKey: ['home-memos'] })
  queryClient.invalidateQueries({ queryKey: ['home-stats'] })
  queryClient.invalidateQueries({ queryKey: ['home-dday'] })
  // 다른 탭에도 신호
  broadcast({ type: 'invalidate', queryKey: ['memos', 'all', false] })
  broadcast({ type: 'invalidate', queryKey: ['plans'] })
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
        .then((result) => applyIdMappings(result.idMappings, queryClient))
        .catch(() => {})
    }
    runFlush()  // online 복귀 즉시
    const id = setInterval(runFlush, RETRY_INTERVAL_MS)
    return () => clearInterval(id)
  }, [online, queryClient])

  return null
}
