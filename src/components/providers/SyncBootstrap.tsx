/**
 * PR-4 — 동기화 인프라 부팅.
 *
 * (main) layout에서 한 번만 마운트.
 *  1. initCurrentUser  : userId 캐싱 + auth 변경 시 LS namespace 청소
 *  2. useBroadcastListener : 같은 브라우저 멀티탭 동기화
 *  3. useRealtimeSync : Supabase Realtime 디바이스 간 동기화 (사용자 토글)
 */

'use client'

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { initCurrentUser } from '@/lib/auth/currentUser'
import { useBroadcastListener } from '@/hooks/useBroadcastListener'
import { useRealtimeSync } from '@/hooks/useRealtimeSync'

export function SyncBootstrap() {
  useEffect(() => {
    const supabase = createClient()
    void initCurrentUser(supabase)
  }, [])

  useBroadcastListener()
  useRealtimeSync()

  return null
}
