/**
 * 오프라인 write queue — IndexedDB 추상 (PR-M1-A).
 *
 * 사용:
 *   enqueueWrite({ table, recordId, patch, knownUpdatedAt })
 *   listPending() / removePending(id) / markFailed(id, err)
 *   countPending() — UI 배너용
 *
 * 동작 보장:
 *   - SSR 안전 (typeof window === 'undefined'면 throw)
 *   - DB 인스턴스 lazy + 모듈 단위 singleton
 *   - 한 row당 최대 5회 재시도 후 give-up
 */

'use client'

import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

export type WriteTable = 'memos' | 'plans' | 'folders'

export interface PendingWrite {
  id: string
  table: WriteTable
  recordId: string
  patch: Record<string, unknown>
  knownUpdatedAt: string
  attempts: number
  createdAt: number
  lastAttemptAt?: number
  lastError?: string
}

interface WeaveOfflineDB extends DBSchema {
  pending_writes: {
    key: string
    value: PendingWrite
    indexes: { 'by-createdAt': number }
  }
}

const DB_NAME = 'weave-offline-queue'
const DB_VERSION = 1
export const MAX_ATTEMPTS = 5

let dbPromise: Promise<IDBPDatabase<WeaveOfflineDB>> | null = null

function getDB() {
  if (typeof window === 'undefined') {
    throw new Error('queueDB only available in browser')
  }
  if (!dbPromise) {
    dbPromise = openDB<WeaveOfflineDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const store = db.createObjectStore('pending_writes', { keyPath: 'id' })
        store.createIndex('by-createdAt', 'createdAt')
      },
    })
  }
  return dbPromise
}

/** 큐에 write 추가. id 자동 생성 → 반환 */
export async function enqueueWrite(
  input: Omit<PendingWrite, 'id' | 'createdAt' | 'attempts'>
): Promise<string> {
  const db = await getDB()
  const id = crypto.randomUUID()
  await db.add('pending_writes', {
    ...input,
    id,
    createdAt: Date.now(),
    attempts: 0,
  })
  return id
}

/** 큐 전체 조회 — createdAt 오름차순 (FIFO) */
export async function listPending(): Promise<PendingWrite[]> {
  if (typeof window === 'undefined') return []
  try {
    const db = await getDB()
    return await db.getAllFromIndex('pending_writes', 'by-createdAt')
  } catch {
    return []
  }
}

/** 성공한 write 제거 */
export async function removePending(id: string): Promise<void> {
  try {
    const db = await getDB()
    await db.delete('pending_writes', id)
  } catch { /* silent */ }
}

/** 실패 — attempts 증가 + lastError 기록 */
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

/** UI용 — pending 개수 */
export async function countPending(): Promise<number> {
  if (typeof window === 'undefined') return 0
  try {
    const db = await getDB()
    return await db.count('pending_writes')
  } catch {
    return 0
  }
}

/** 전체 큐 비우기 — 디버깅/리셋용 */
export async function clearAllPending(): Promise<void> {
  try {
    const db = await getDB()
    await db.clear('pending_writes')
  } catch { /* silent */ }
}
