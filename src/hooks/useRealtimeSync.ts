/**
 * Supabase Realtime 구독 — 디바이스 간 즉시 동기화.
 *
 * 사용:
 *   useRealtimeSync()  // 자동으로 사용자 토글 상태에 따라 on/off
 *
 * 동작:
 *   - localStorage `weave-{userId}-realtime-sync`가 'false'면 OFF
 *   - 그 외 (없거나 'true')는 ON (기본값)
 *   - userId가 없으면(비로그인) skip
 *   - memos / plans / folders 3개 테이블 구독, 본인 row만
 *   - 다른 디바이스 변경 → React Query/Zustand 캐시 invalidate
 *
 * Supabase 대시보드 설정 필요:
 *   Database → Replication → supabase_realtime publication에
 *   memos, plans, folders 테이블 추가
 *
 * 비용:
 *   Free tier 200 concurrent / 2M msg/월 — 사용자 100명까지 무료
 */

'use client'

import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { getCurrentUserId } from '@/lib/auth/currentUser'
import { lsRealtimeSync } from '@/lib/cache/lsKeys'
import { useMemoStore } from '@/store/memoStore'
import { usePlannerStore } from '@/store/plannerStore'
import { useFolderStore } from '@/store/folderStore'

/** 토글 상태 읽기 — 기본 ON */
export function isRealtimeEnabled(): boolean {
  if (typeof window === 'undefined') return false
  const key = lsRealtimeSync()
  if (!key) return false
  try {
    const v = localStorage.getItem(key)
    // 값 없음 또는 'true' → ON, 'false' 명시일 때만 OFF
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

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!isRealtimeEnabled()) return

    const userId = getCurrentUserId()
    if (!userId) return

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
            // plans는 React Query 없이 Zustand만 → 다음 load() 시점에 fresh fetch
            // 즉시 반영하려면 usePlanner의 load()를 트리거해야 하지만,
            // 그러려면 globally 접근 가능한 reload 함수가 필요 → 우선 home 캐시만 invalidate
            queryClient.invalidateQueries({ queryKey: ['home-stats'] })
            queryClient.invalidateQueries({ queryKey: ['home-dday'] })
            // 다음 라우트 진입 시 usePlanner가 load() 함
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
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
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
    // Zustand store imports just to satisfy lint — actual invalidations above use queryClient
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryClient])

  // Touch zustand imports to keep them in tree-shake-safe state
  void useMemoStore
  void usePlannerStore
  void useFolderStore
}
