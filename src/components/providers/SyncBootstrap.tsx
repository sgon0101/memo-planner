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
import { createClient } from '@/lib/supabase/client'
import { initCurrentUser } from '@/lib/auth/currentUser'
import { useBroadcastListener } from '@/hooks/useBroadcastListener'
import { useRealtimeSync } from '@/hooks/useRealtimeSync'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { flushQueue } from '@/lib/sync/withQueue'

const RETRY_INTERVAL_MS = 30_000  // 30초마다 큐 잔여 retry

export function SyncBootstrap() {
  useEffect(() => {
    const supabase = createClient()
    void initCurrentUser(supabase)
  }, [])

  useBroadcastListener()
  useRealtimeSync()

  // PR-M1-A: online 상태 변경 시 + 주기적 큐 flush
  const online = useOnlineStatus()
  useEffect(() => {
    if (!online) return
    // online 복귀 즉시 flush
    flushQueue().catch(() => {})
    // 그 후 30초마다 retry (실패한 row 재시도)
    const id = setInterval(() => {
      flushQueue().catch(() => {})
    }, RETRY_INTERVAL_MS)
    return () => clearInterval(id)
  }, [online])

  return null
}
