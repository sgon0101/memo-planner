/**
 * 오프라인 write queue — IndexedDB 추상 (PR-M1-B 확장).
 *
 * v1 (M1-A): update op만
 * v2 (M1-B): memo-insert / plan-insert / memo-body-update 추가 + id_map store
 *
 * Op 타입:
 *   - update          : 기존 row의 patch update (별표·고정·완료·폴더이동 등)
 *   - memo-insert     : 신규 메모 server insert (임시 ID 사용)
 *   - plan-insert     : 신규 플랜 server insert (임시 ID 사용)
 *   - memo-body-update: 메모 본문/제목 자동저장 (overwrite — 같은 memoId 최신만)
 */

'use client'

import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

export type WriteTable = 'memos' | 'plans' | 'folders'

export type PendingOp =
  | {
      op: 'update'
      table: WriteTable
      recordId: string
      patch: Record<string, unknown>
      knownUpdatedAt: string
    }
  | {
      op: 'memo-insert'
      tempId: string
      fields: Record<string, unknown>
    }
  | {
      op: 'plan-insert'
      tempId: string
      fields: Record<string, unknown>
    }
  | {
      op: 'memo-body-update'
      recordId: string  // 임시 ID 가능 (idMap으로 매핑)
      fields: Record<string, unknown>  // title/content/content_text/tags/wiki_links 등
      knownUpdatedAt: string
    }

export interface PendingWrite {
  id: string
  payload: PendingOp
  attempts: number
  createdAt: number
  lastAttemptAt?: number
  lastError?: string
}

export interface IdMapping {
  tempId: string
  realId: string
  createdAt: number
}

interface WeaveOfflineDB extends DBSchema {
  pending_writes: {
    key: string
    value: PendingWrite
    indexes: { 'by-createdAt': number }
  }
  id_map: {
    key: string  // tempId
    value: IdMapping
  }
}

const DB_NAME = 'weave-offline-queue'
const DB_VERSION = 2  // M1-A의 v1에서 업그레이드
export const MAX_ATTEMPTS = 5

let dbPromise: Promise<IDBPDatabase<WeaveOfflineDB>> | null = null

function getDB() {
  if (typeof window === 'undefined') {
    throw new Error('queueDB only available in browser')
  }
  if (!dbPromise) {
    dbPromise = openDB<WeaveOfflineDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        // v0 → v1: pending_writes 생성 (M1-A)
        if (oldVersion < 1) {
          const store = db.createObjectStore('pending_writes', { keyPath: 'id' })
          store.createIndex('by-createdAt', 'createdAt')
        }
        // v1 → v2: id_map 추가 + pending_writes는 호환 유지 (M1-B)
        if (oldVersion < 2) {
          if (!db.objectStoreNames.contains('id_map')) {
            db.createObjectStore('id_map', { keyPath: 'tempId' })
          }
          // 옛 v1 row(table/recordId 직접 필드)는 그대로 두고 — 새 enqueue부터는
          // payload 형식 사용. flushQueue가 backward-compat 처리.
        }
      },
    })
  }
  return dbPromise
}

// ─── pending_writes API ─────────────────────────────────────────

/** 일반 enqueue — payload 형태 그대로 적재 */
export async function enqueue(payload: PendingOp): Promise<string> {
  const db = await getDB()
  const id = crypto.randomUUID()
  await db.add('pending_writes', {
    id,
    payload,
    attempts: 0,
    createdAt: Date.now(),
  })
  return id
}

/** 본문 큐는 같은 memoId 최신만 유지 — overwrite */
export async function enqueueBodyOverwrite(
  recordId: string,
  fields: Record<string, unknown>,
  knownUpdatedAt: string,
): Promise<string> {
  const db = await getDB()
  // 같은 memoId의 기존 body-update row 삭제
  const all = await db.getAll('pending_writes')
  for (const w of all) {
    if (w.payload.op === 'memo-body-update' && w.payload.recordId === recordId) {
      await db.delete('pending_writes', w.id)
    }
  }
  return enqueue({ op: 'memo-body-update', recordId, fields, knownUpdatedAt })
}

/** 호환 헬퍼 — M1-A 기존 호출 호환 */
export async function enqueueWrite(input: {
  table: WriteTable
  recordId: string
  patch: Record<string, unknown>
  knownUpdatedAt: string
}): Promise<string> {
  return enqueue({
    op: 'update',
    table: input.table,
    recordId: input.recordId,
    patch: input.patch,
    knownUpdatedAt: input.knownUpdatedAt,
  })
}

export async function listPending(): Promise<PendingWrite[]> {
  if (typeof window === 'undefined') return []
  try {
    const db = await getDB()
    return await db.getAllFromIndex('pending_writes', 'by-createdAt')
  } catch {
    return []
  }
}

export async function removePending(id: string): Promise<void> {
  try {
    const db = await getDB()
    await db.delete('pending_writes', id)
  } catch { /* silent */ }
}

export async function markFailed(id: string, errMsg: string): Promise<void> {
  try {
    const db = await getDB()
    const existing = await db.get('pending_writes', id)
    if (!existing) return
    await db.put('pending_writes', {
      ...existing,
      attempts: existing.attempts + 1,
      lastAttemptAt: Date.now(),
      lastError: errMsg,
    })
  } catch { /* silent */ }
}

export async function countPending(): Promise<number> {
  if (typeof window === 'undefined') return 0
  try {
    const db = await getDB()
    return await db.count('pending_writes')
  } catch {
    return 0
  }
}

export async function clearAllPending(): Promise<void> {
  try {
    const db = await getDB()
    await db.clear('pending_writes')
  } catch { /* silent */ }
}

// ─── id_map API ─────────────────────────────────────────────────

/** flush 시 임시 ID → 진짜 ID 매핑 저장 */
export async function recordIdMapping(tempId: string, realId: string): Promise<void> {
  try {
    const db = await getDB()
    await db.put('id_map', { tempId, realId, createdAt: Date.now() })
  } catch { /* silent */ }
}

/** tempId → realId 조회 (없으면 tempId 그대로 반환 — 매핑 안 됐다는 의미) */
export async function resolveTempId(tempId: string): Promise<string | null> {
  if (typeof window === 'undefined') return null
  try {
    const db = await getDB()
    const m = await db.get('id_map', tempId)
    return m?.realId ?? null
  } catch {
    return null
  }
}

/** UI에서 메모 진입 시 — 임시 ID면 매핑 조회 후 진짜 ID로 redirect 등 */
export async function getAllIdMappings(): Promise<IdMapping[]> {
  if (typeof window === 'undefined') return []
  try {
    const db = await getDB()
    return await db.getAll('id_map')
  } catch {
    return []
  }
}

/** idMap 정리 — 7일 지난 매핑은 삭제 (사용 가능성 낮음) */
export async function pruneOldIdMappings(maxAgeMs = 7 * 24 * 60 * 60 * 1000): Promise<number> {
  try {
    const db = await getDB()
    const all = await db.getAll('id_map')
    const cutoff = Date.now() - maxAgeMs
    let removed = 0
    for (const m of all) {
      if (m.createdAt < cutoff) {
        await db.delete('id_map', m.tempId)
        removed++
      }
    }
    return removed
  } catch { return 0 }
}

// ─── 헬퍼 — 임시 ID 생성 ───────────────────────────────────────────
export function makeTempId(prefix: 'memo' | 'plan'): string {
  return `tmp_${prefix}_${crypto.randomUUID().replace(/-/g, '')}`
}

export function isTempId(id: string | null | undefined): boolean {
  return !!id && id.startsWith('tmp_')
}
