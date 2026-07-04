/**
 * BroadcastChannel 수신 → React Query 캐시 + Zustand 스토어 자동 갱신.
 *
 * 마운트 위치: (main) 레이아웃 또는 providers 한 군데.
 *
 * 메모: React Query 단일 출처 (memoStore 거울 제거 — 상태 이중화 정리 1단계)
 * 플랜: React Query 단일 출처 (plannerStore 거울 제거 — 상태 이중화 정리 2단계)
 * 폴더: React Query + Zustand 둘 다
 */

'use client'

import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { onBroadcast, type SyncEvent } from '@/lib/sync/broadcast'
import { useFolderStore } from '@/store/folderStore'
import { patchPlanInCaches, addPlanToCaches, removePlanFromCaches } from '@/lib/planner/planCache'
import { removeTempIdsFromCaches, applyImageSwapToCaches } from '@/lib/sync/cacheCleanup'
import { lsHomeMemosCache, lsHomeMemosCacheTs } from '@/lib/cache/lsKeys'
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
          queryClient.invalidateQueries({ queryKey: ['home-memos'] })
          queryClient.invalidateQueries({ queryKey: ['home-stats'] })
          break
        }
        case 'memo-create': {
          queryClient.setQueryData<Memo[]>(['memos', 'all', false], (old) =>
            old ? [event.memo, ...old.filter((m) => m.id !== event.memo.id)] : [event.memo],
          )
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
          queryClient.invalidateQueries({ queryKey: ['memo-folder-counts'] })
          // PR-M2-fix: home-memos는 setQueryData(filter) + LS 직접 청소
          // (invalidate만 두면 다음 mount 시 server replication lag로 stale 받음)
          queryClient.setQueryData<{ recentMemos: Array<{ id: string }> } | undefined>(
            ['home-memos'],
            (old) => old ? { ...old, recentMemos: old.recentMemos.filter((m) => m.id !== event.id) } : old,
          )
          if (typeof window !== 'undefined') {
            try {
              const k = lsHomeMemosCache()
              const kts = lsHomeMemosCacheTs()
              if (k) {
                const raw = localStorage.getItem(k)
                if (raw) {
                  const parsed = JSON.parse(raw) as { recentMemos: Array<{ id: string }> }
                  const next = { ...parsed, recentMemos: parsed.recentMemos.filter((m) => m.id !== event.id) }
                  localStorage.setItem(k, JSON.stringify(next))
                  if (kts) localStorage.setItem(kts, String(Date.now()))
                }
              }
            } catch { /* ignore */ }
          }
          break
        }

        // ─── Plans (React Query 단일 출처) ─────────────────────────────
        case 'plan-update': {
          patchPlanInCaches(queryClient, event.id, {
            ...event.patch,
            updatedAt: event.updated_at,
          })
          queryClient.invalidateQueries({ queryKey: ['home-stats'] })
          queryClient.invalidateQueries({ queryKey: ['home-dday'] })
          break
        }
        case 'plan-create': {
          addPlanToCaches(queryClient, event.plan)
          queryClient.invalidateQueries({ queryKey: ['home-stats'] })
          queryClient.invalidateQueries({ queryKey: ['home-dday'] })
          break
        }
        case 'plan-delete': {
          removePlanFromCaches(queryClient, event.id)
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
        // ─── PR-M1-B 후속: 다른 탭의 큐 give-up cleanup 수신 ─────
        case 'queue-giveup': {
          removeTempIdsFromCaches(event.tempIds, queryClient)
          break
        }

        // ─── PR-M1-C: 다른 탭의 이미지 R2 swap 수신 ─────────────────
        case 'image-swap': {
          applyImageSwapToCaches(event.mappings, queryClient)
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
