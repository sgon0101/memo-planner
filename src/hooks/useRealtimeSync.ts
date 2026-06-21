/**
 * Supabase Realtime 구독 — 디바이스 간 즉시 동기화.
 *
 * 사용:
 *   useRealtimeSync()  // SyncBootstrap에서 한 번 호출
 *
 * 동작:
 *   - userId가 set될 때까지 대기 (useCurrentUserId 구독)
 *   - localStorage `weave-{userId}-realtime-sync`가 'false'면 OFF
 *   - 그 외 (없거나 'true')는 ON (기본값)
 *   - memos / plans / folders 3개 테이블 구독, 본인 row만
 *   - 다른 디바이스 변경 → React Query 캐시 invalidate
 *
 * Supabase 대시보드 설정 필요:
 *   Database → Publications → supabase_realtime
 *   → memos, plans, folders 3개 테이블 추가
 *
 * 비용:
 *   Free tier 200 concurrent / 2M msg/월 — 사용자 100명까지 무료
 */

'use client'

import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { useCurrentUserId } from './useCurrentUserId'
import { lsRealtimeSync } from '@/lib/cache/lsKeys'

/** 토글 상태 읽기 — 기본 ON */
export function isRealtimeEnabled(): boolean {
  if (typeof window === 'undefined') return false
  const key = lsRealtimeSync()
  if (!key) return false
  try {
    const v = localStorage.getItem(key)
    return v !== 'false'
  } catch {
    return true
  }
}

/** 토글 변경 — UI에서 사용 */
export function setRealtimeEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return
  const key = lsRealtimeSync()
  if (!key) return
  try {
    localStorage.setItem(key, enabled ? 'true' : 'false')
  } catch { /* ignore */ }
}

export function useRealtimeSync(): void {
  const queryClient = useQueryClient()
  const userId = useCurrentUserId()  // ★ reactive — userId set되면 effect 재실행

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!isRealtimeEnabled()) return
    if (!userId) return  // userId 준비 대기

    const supabase = createClient()
    let channel: RealtimeChannel | null = null

    try {
      channel = supabase
        .channel(`weave:user:${userId}`)
        // memos
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'memos', filter: `user_id=eq.${userId}` },
          () => {
            queryClient.invalidateQueries({ queryKey: ['memos', 'all', false] })
            queryClient.invalidateQueries({ queryKey: ['memos', 'trash'] })
            queryClient.invalidateQueries({ queryKey: ['memo-folder-counts'] })
            queryClient.invalidateQueries({ queryKey: ['home-memos'] })
            queryClient.invalidateQueries({ queryKey: ['home-stats'] })
          },
        )
        // plans
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'plans', filter: `user_id=eq.${userId}` },
          () => {
            queryClient.invalidateQueries({ queryKey: ['home-stats'] })
            queryClient.invalidateQueries({ queryKey: ['home-dday'] })
            // plans는 React Query 미사용 — 다음 라우트 진입 시 usePlanner.load() fresh fetch
          },
        )
        // folders
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'folders', filter: `user_id=eq.${userId}` },
          () => {
            queryClient.invalidateQueries({ queryKey: ['folders'] })
            queryClient.invalidateQueries({ queryKey: ['memo-folder-counts'] })
          },
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') {
            console.log('[weave:realtime] subscribed for user:', userId)
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            console.warn('[weave:realtime] channel status:', status)
          }
        })
    } catch (e) {
      console.warn('[weave:realtime] failed to subscribe:', e)
    }

    return () => {
      if (channel) {
        try { supabase.removeChannel(channel) } catch { /* ignore */ }
      }
    }
  }, [queryClient, userId])  // ★ userId가 deps에 들어가서 set되는 시점에 effect 재실행
}
