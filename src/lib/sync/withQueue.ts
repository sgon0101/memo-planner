/**
 * 오프라인 큐 통합 write 래퍼 (PR-M1-A).
 *
 * 정책:
 *   - online: safeUpdateOrForce 직접 호출 (PR-4)
 *   - offline: IndexedDB 큐에 enqueue, UI는 optimistic 유지
 *   - online 복귀 시 flushQueue() — silent force로 last-write-wins
 *   - 5회 이상 실패한 row는 give-up (영구 에러 추정)
 *
 * 호출자(useMemos/usePlanner)는 이 함수만 쓰면 됨.
 */

'use client'

import { safeUpdateOrForce, type SafeUpdateResult } from '@/lib/db/safeUpdate'
import {
  enqueueWrite,
  listPending,
  removePending,
  markFailed,
  MAX_ATTEMPTS,
  type WriteTable,
} from './queueDB'

export interface WriteOrQueueOpts {
  table: WriteTable
  recordId: string
  patch: Record<string, unknown>
  knownUpdatedAt: string
}

export interface WriteOrQueueResult {
  /** true면 큐에 들어감(오프라인), false면 즉시 server update 완료 */
  queued: boolean
  /** queued=false일 때만 — 새 updated_at 반환 */
  updated_at?: string
}

function isOnline(): boolean {
  if (typeof navigator === 'undefined') return true  // SSR — 일단 online으로
  return navigator.onLine
}

/**
 * 핵심 래퍼 — online이면 직접 update, offline이면 큐.
 * 호출자는 결과 queued 보고 UI 동기화 결정.
 */
export async function writeOrQueue(opts: WriteOrQueueOpts): Promise<WriteOrQueueResult> {
  if (isOnline()) {
    try {
      const result: SafeUpdateResult = await safeUpdateOrForce(
        {
          table: opts.table,
          id: opts.recordId,
          patch: opts.patch,
          knownUpdatedAt: opts.knownUpdatedAt,
        },
        () => console.warn('[weave:conflict]', opts.table, opts.recordId),
      )
      return { queued: false, updated_at: result.updated_at }
    } catch (e) {
      // online이지만 실패 (네트워크 일시 끊김 / RLS / 서버 에러)
      // 네트워크 추정이면 큐로 — 안 그러면 throw
      const msg = e instanceof Error ? e.message.toLowerCase() : ''
      const isNetwork = msg.includes('fetch') || msg.includes('network') || msg.includes('timeout')
      if (isNetwork) {
        await enqueueWrite(opts)
        console.warn('[weave:queue] network error → enqueued', opts.recordId)
        return { queued: true }
      }
      throw e  // 진짜 DB 에러 — 호출자가 처리
    }
  }

  // offline — queue
  await enqueueWrite(opts)
  return { queued: true }
}

/**
 * 큐 전체 flush — online 복귀 시 호출.
 * FIFO 순서로 시도, 성공하면 remove, 실패하면 markFailed (5회 후 give-up).
 */
export async function flushQueue(): Promise<{ flushed: number; failed: number; gaveUp: number }> {
  if (!isOnline()) return { flushed: 0, failed: 0, gaveUp: 0 }

  const pending = await listPending()
  if (pending.length === 0) return { flushed: 0, failed: 0, gaveUp: 0 }

  let flushed = 0, failed = 0, gaveUp = 0

  for (const item of pending) {
    try {
      await safeUpdateOrForce(
        {
          table: item.table,
          id: item.recordId,
          patch: item.patch,
          knownUpdatedAt: item.knownUpdatedAt,
        },
        () => console.warn('[weave:offline-conflict]', item.table, item.recordId),
      )
      await removePending(item.id)
      flushed++
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'unknown'
      if (item.attempts + 1 >= MAX_ATTEMPTS) {
        console.warn('[weave:queue:giveup]', item.table, item.recordId, msg)
        await removePending(item.id)
        gaveUp++
      } else {
        await markFailed(item.id, msg)
        failed++
      }
    }
  }

  return { flushed, failed, gaveUp }
}
