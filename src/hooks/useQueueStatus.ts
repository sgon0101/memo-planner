/**
 * 오프라인 큐 pending 개수 reactive (PR-M1-A).
 *
 * 사용:
 *   const { pendingCount, refresh } = useQueueStatus()
 *   if (pendingCount > 0) show banner
 *
 * - 2초마다 polling — flush 진행 상황 반영
 * - refresh()로 즉시 갱신 가능
 */

'use client'

import { useCallback, useEffect, useState } from 'react'
import { countPending } from '@/lib/sync/queueDB'

const POLL_INTERVAL_MS = 2_000

export interface QueueStatus {
  pendingCount: number
  refresh: () => Promise<void>
}

export function useQueueStatus(): QueueStatus {
  const [pendingCount, setPendingCount] = useState(0)

  const refresh = useCallback(async () => {
    try {
      const n = await countPending()
      setPendingCount(n)
    } catch { /* SSR / IDB 없음 */ }
  }, [])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, POLL_INTERVAL_MS)
    return () => clearInterval(id)
  }, [refresh])

  return { pendingCount, refresh }
}
