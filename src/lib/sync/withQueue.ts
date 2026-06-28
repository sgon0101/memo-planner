/**
 * 오프라인 큐 통합 write 래퍼 (M1-A + M1-B).
 *
 * M1-A:
 *   - writeOrQueue({ table, recordId, patch, knownUpdatedAt }) — 단순 update
 *
 * M1-B 신규:
 *   - createMemoOrQueue(fields) — 신규 메모 작성 (online: server insert / offline: 임시 ID + 큐)
 *   - createPlanOrQueue(fields) — 신규 플랜 작성
 *   - updateMemoBodyOrQueue(recordId, fields, knownUpdatedAt) — 본문/제목 overwrite 큐
 *
 * flushQueue:
 *   - op별 분기 처리
 *   - memo/plan insert → server insert → idMap 기록 → 후속 큐 row의 임시 ID 자동 매핑
 *   - body-update / update → recordId가 tmp면 idMap에서 진짜 ID 매핑
 *   - 5회 실패 시 give-up
 */

'use client'

import { createClient } from '@/lib/supabase/client'
import { safeUpdateOrForce } from '@/lib/db/safeUpdate'
import {
  enqueue,
  enqueueBodyOverwrite,
  listPending,
  removePending,
  markFailed,
  recordIdMapping,
  resolveTempId,
  MAX_ATTEMPTS,
  isTempId,
  type WriteTable,
  type PendingOp,
} from './queueDB'

function isOnline(): boolean {
  if (typeof navigator === 'undefined') return true
  return navigator.onLine
}

// ─── M1-A 호환: 단순 update ──────────────────────────────────────

export interface WriteOrQueueOpts {
  table: WriteTable
  recordId: string
  patch: Record<string, unknown>
  knownUpdatedAt: string
}

export interface WriteOrQueueResult {
  queued: boolean
  updated_at?: string
}

export async function writeOrQueue(opts: WriteOrQueueOpts): Promise<WriteOrQueueResult> {
  // PR-M1-B: tempId — 항상 큐 (server엔 아직 그 row가 없음, insert가 큐에 먼저 있어야 함)
  if (isTempId(opts.recordId)) {
    await enqueue({
      op: 'update',
      table: opts.table,
      recordId: opts.recordId,
      patch: opts.patch,
      knownUpdatedAt: opts.knownUpdatedAt,
    })
    return { queued: true }
  }
  if (isOnline()) {
    try {
      const result = await safeUpdateOrForce(
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
      const msg = e instanceof Error ? e.message.toLowerCase() : ''
      const isNetwork = msg.includes('fetch') || msg.includes('network') || msg.includes('timeout')
      if (isNetwork) {
        await enqueue({
          op: 'update',
          table: opts.table,
          recordId: opts.recordId,
          patch: opts.patch,
          knownUpdatedAt: opts.knownUpdatedAt,
        })
        console.warn('[weave:queue] network error → enqueued', opts.recordId)
        return { queued: true }
      }
      throw e
    }
  }
  await enqueue({
    op: 'update',
    table: opts.table,
    recordId: opts.recordId,
    patch: opts.patch,
    knownUpdatedAt: opts.knownUpdatedAt,
  })
  return { queued: true }
}

// ─── M1-B 신규: 신규 메모/플랜 작성 ──────────────────────────────

export interface CreateResult<T> {
  queued: boolean
  /** queued=false면 server에서 받은 진짜 id, queued=true면 임시 id */
  id: string
  /** server 응답 row (queued=false일 때만) */
  row?: T
}

/**
 * 신규 메모 작성 — online이면 supabase insert, offline이면 임시 ID + 큐.
 *
 * @param fields - memo row의 insert 필드 (user_id 제외 — RLS가 처리)
 * @param tempId - 임시 ID (caller가 미리 생성, UI에 즉시 표시 가능)
 */
export async function createMemoOrQueue(
  fields: Record<string, unknown>,
  tempId: string,
): Promise<CreateResult<Record<string, unknown>>> {
  if (isOnline()) {
    try {
      const supabase = createClient()
      const { data: row, error } = await supabase
        .from('memos')
        .insert(fields)
        .select()
        .single()
      if (error) throw error
      return { queued: false, id: (row.id as string), row }
    } catch (e) {
      const msg = e instanceof Error ? e.message.toLowerCase() : ''
      const isNetwork = msg.includes('fetch') || msg.includes('network') || msg.includes('timeout')
      if (isNetwork) {
        await enqueue({ op: 'memo-insert', tempId, fields })
        return { queued: true, id: tempId }
      }
      throw e
    }
  }
  await enqueue({ op: 'memo-insert', tempId, fields })
  return { queued: true, id: tempId }
}

/** 신규 플랜 작성 — createMemoOrQueue와 동일 패턴 */
export async function createPlanOrQueue(
  fields: Record<string, unknown>,
  tempId: string,
): Promise<CreateResult<Record<string, unknown>>> {
  if (isOnline()) {
    try {
      const supabase = createClient()
      const { data: row, error } = await supabase
        .from('plans')
        .insert(fields)
        .select()
        .single()
      if (error) throw error
      return { queued: false, id: (row.id as string), row }
    } catch (e) {
      const msg = e instanceof Error ? e.message.toLowerCase() : ''
      const isNetwork = msg.includes('fetch') || msg.includes('network') || msg.includes('timeout')
      if (isNetwork) {
        await enqueue({ op: 'plan-insert', tempId, fields })
        return { queued: true, id: tempId }
      }
      throw e
    }
  }
  await enqueue({ op: 'plan-insert', tempId, fields })
  return { queued: true, id: tempId }
}

/**
 * 메모 본문/제목 자동저장 — overwrite 큐.
 * 같은 memoId의 기존 body-update 큐는 교체됨 (마지막 입력만 의미).
 */
export async function updateMemoBodyOrQueue(opts: {
  recordId: string
  fields: Record<string, unknown>
  knownUpdatedAt: string
}): Promise<WriteOrQueueResult> {
  if (isOnline() && !isTempId(opts.recordId)) {
    try {
      const result = await safeUpdateOrForce(
        {
          table: 'memos',
          id: opts.recordId,
          patch: opts.fields,
          knownUpdatedAt: opts.knownUpdatedAt,
        },
        () => console.warn('[weave:conflict] memos body', opts.recordId),
      )
      return { queued: false, updated_at: result.updated_at }
    } catch (e) {
      const msg = e instanceof Error ? e.message.toLowerCase() : ''
      const isNetwork = msg.includes('fetch') || msg.includes('network') || msg.includes('timeout')
      if (isNetwork) {
        await enqueueBodyOverwrite(opts.recordId, opts.fields, opts.knownUpdatedAt)
        return { queued: true }
      }
      throw e
    }
  }
  // offline 또는 tempId — 큐
  await enqueueBodyOverwrite(opts.recordId, opts.fields, opts.knownUpdatedAt)
  return { queued: true }
}

// ─── flushQueue — op별 분기 + idMap ──────────────────────────────

export interface FlushResult {
  flushed: number
  failed: number
  gaveUp: number
  /** 임시 ID → 진짜 ID 매핑 (UI가 이걸로 zustand store + URL 갱신) */
  idMappings: Array<{ tempId: string; realId: string }>
}

export async function flushQueue(): Promise<FlushResult> {
  if (!isOnline()) return { flushed: 0, failed: 0, gaveUp: 0, idMappings: [] }

  const pending = await listPending()
  if (pending.length === 0) return { flushed: 0, failed: 0, gaveUp: 0, idMappings: [] }

  const supabase = createClient()
  let flushed = 0, failed = 0, gaveUp = 0
  const idMappings: Array<{ tempId: string; realId: string }> = []

  for (const item of pending) {
    try {
      await processOne(item.payload, supabase, idMappings)
      await removePending(item.id)
      flushed++
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'unknown'
      if (item.attempts + 1 >= MAX_ATTEMPTS) {
        console.warn('[weave:queue:giveup]', JSON.stringify(item.payload).slice(0, 100), msg)
        await removePending(item.id)
        gaveUp++
      } else {
        await markFailed(item.id, msg)
        failed++
      }
    }
  }

  return { flushed, failed, gaveUp, idMappings }
}

// 헬퍼 — 단일 큐 row 처리
async function processOne(
  payload: PendingOp,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  idMappings: Array<{ tempId: string; realId: string }>,
): Promise<void> {
  if (payload.op === 'memo-insert') {
    const { data: row, error } = await supabase
      .from('memos')
      .insert(payload.fields)
      .select()
      .single()
    if (error) throw error
    const realId = row.id as string
    await recordIdMapping(payload.tempId, realId)
    idMappings.push({ tempId: payload.tempId, realId })
    return
  }
  if (payload.op === 'plan-insert') {
    const { data: row, error } = await supabase
      .from('plans')
      .insert(payload.fields)
      .select()
      .single()
    if (error) throw error
    const realId = row.id as string
    await recordIdMapping(payload.tempId, realId)
    idMappings.push({ tempId: payload.tempId, realId })
    return
  }
  if (payload.op === 'memo-body-update') {
    // recordId가 tmp면 idMap에서 진짜 ID 매핑
    const realId = isTempId(payload.recordId)
      ? (await resolveTempId(payload.recordId)) ?? payload.recordId
      : payload.recordId
    // tmp인데 매핑 아직 안 됨 — memo-insert가 큐 안에 더 뒤에 있을 수 있어 에러
    if (isTempId(realId)) {
      throw new Error(`unresolved tempId: ${realId} (memo-insert가 큐 안에 있어야 함)`)
    }
    await safeUpdateOrForce(
      {
        table: 'memos',
        id: realId,
        patch: payload.fields,
        knownUpdatedAt: payload.knownUpdatedAt,
      },
      () => console.warn('[weave:offline-conflict] memos body', realId),
    )
    return
  }
  if (payload.op === 'update') {
    const realId = isTempId(payload.recordId)
      ? (await resolveTempId(payload.recordId)) ?? payload.recordId
      : payload.recordId
    if (isTempId(realId)) {
      throw new Error(`unresolved tempId: ${realId}`)
    }
    await safeUpdateOrForce(
      {
        table: payload.table,
        id: realId,
        patch: payload.patch,
        knownUpdatedAt: payload.knownUpdatedAt,
      },
      () => console.warn('[weave:offline-conflict]', payload.table, realId),
    )
    return
  }
}
