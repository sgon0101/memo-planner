/**
 * BroadcastChannel 수신 → React Query 캐시 + Zustand 스토어 자동 갱신.
 *
 * 마운트 위치: (main) 레이아웃 또는 providers 한 군데.
 *
 * 메모: React Query + Zustand 둘 다 갱신 (다른 페이지 대비)
 * 플랜: Zustand만 (usePlanner가 React Query를 안 씀)
 * 폴더: React Query + Zustand 둘 다
 */

'use client'

import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { onBroadcast, type SyncEvent } from '@/lib/sync/broadcast'
import { useMemoStore } from '@/store/memoStore'
import { usePlannerStore } from '@/store/plannerStore'
import { useFolderStore } from '@/store/folderStore'
import type { Memo } from '@/types'

export function useBroadcastListener(): void {
  const queryClient = useQueryClient()

  useEffect(() => {
    const off = onBroadcast((event: SyncEvent) => {
      switch (event.type) {
        // ─── Memos ────────────────────────────────────────────────────
        case 'memo-update': {
          const patchWithTime = { ...event.patch, updatedAt: event.updated_at }
          queryClient.setQueryData<Memo[]>(['memos', 'all', false], (old) =>
            old?.map((m) => (m.id === event.id ? { ...m, ...patchWithTime } : m)),
          )
          queryClient.setQueryData<Memo[]>(['memos', 'trash'], (old) =>
            old?.map((m) => (m.id === event.id ? { ...m, ...patchWithTime } : m)),
          )
          useMemoStore.getState().updateMemo(event.id, patchWithTime)
          queryClient.invalidateQueries({ queryKey: ['home-memos'] })
          queryClient.invalidateQueries({ queryKey: ['home-stats'] })
          break
        }
        case 'memo-create': {
          queryClient.setQueryData<Memo[]>(['memos', 'all', false], (old) =>
            old ? [event.memo, ...old.filter((m) => m.id !== event.memo.id)] : [event.memo],
          )
          useMemoStore.getState().addMemo(event.memo)
          queryClient.invalidateQueries({ queryKey: ['memo-folder-counts'] })
          queryClient.invalidateQueries({ queryKey: ['home-memos'] })
          break
        }
        case 'memo-delete': {
          queryClient.setQueryData<Memo[]>(['memos', 'all', false], (old) =>
            old?.filter((m) => m.id !== event.id),
          )
          queryClient.setQueryData<Memo[]>(['memos', 'trash'], (old) =>
            old?.filter((m) => m.id !== event.id),
          )
          useMemoStore.getState().deleteMemo(event.id)
          queryClient.invalidateQueries({ queryKey: ['memo-folder-counts'] })
          queryClient.invalidateQueries({ queryKey: ['home-memos'] })
          break
        }

        // ─── Plans (Zustand만 사용) ────────────────────────────────────
        case 'plan-update': {
          usePlannerStore.getState().updatePlan(event.id, {
            ...event.patch,
            updatedAt: event.updated_at,
          })
          queryClient.invalidateQueries({ queryKey: ['home-stats'] })
          queryClient.invalidateQueries({ queryKey: ['home-dday'] })
          break
        }
        case 'plan-create': {
          usePlannerStore.getState().addPlan(event.plan)
          queryClient.invalidateQueries({ queryKey: ['home-stats'] })
          queryClient.invalidateQueries({ queryKey: ['home-dday'] })
          break
        }
        case 'plan-delete': {
          usePlannerStore.getState().deletePlan(event.id)
          queryClient.invalidateQueries({ queryKey: ['home-stats'] })
          queryClient.invalidateQueries({ queryKey: ['home-dday'] })
          break
        }

        // ─── Folders ──────────────────────────────────────────────────
        case 'folder-update': {
          useFolderStore.getState().updateFolder(event.id, {
            ...event.patch,
            updatedAt: event.updated_at,
          })
          queryClient.invalidateQueries({ queryKey: ['folders'] })
          queryClient.invalidateQueries({ queryKey: ['memo-folder-counts'] })
          break
        }
        case 'folder-create': {
          useFolderStore.getState().addFolder(event.folder)
          queryClient.invalidateQueries({ queryKey: ['folders'] })
          break
        }
        case 'folder-delete': {
          useFolderStore.getState().deleteFolder(event.id)
          queryClient.invalidateQueries({ queryKey: ['folders'] })
          queryClient.invalidateQueries({ queryKey: ['memo-folder-counts'] })
          break
        }

        // ─── Generic invalidate ───────────────────────────────────────
        case 'invalidate': {
          queryClient.invalidateQueries({ queryKey: event.queryKey })
          break
        }
      }
    })
    return off
  }, [queryClient])
}
