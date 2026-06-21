/**
 * Optimistic locking 헬퍼 — updated_at 기반 충돌 감지.
 *
 * 동작:
 *   - UPDATE 시 .eq('updated_at', knownUpdatedAt) 조건을 추가.
 *   - 다른 디바이스/탭이 먼저 수정해서 updated_at이 바뀌었으면 0 row 영향.
 *   - 0 row면 ConflictError throw → 호출자가 rollback + 사용자 알림.
 *
 * 전제:
 *   - DB에 PR-1 0006_updated_at_triggers가 적용돼 있어야 함.
 *     (touch_updated_at 트리거가 UPDATE마다 updated_at = now() 보장)
 *
 * 사용 예:
 *   try {
 *     const { updated_at } = await safeUpdate({
 *       table: 'memos',
 *       id: memo.id,
 *       patch: { title: '새 제목' },
 *       knownUpdatedAt: memo.updatedAt,
 *     })
 *     // 캐시에 새 updated_at 반영
 *     patchCache(old => old.map(m => m.id === memo.id ? { ...m, updatedAt: updated_at } : m))
 *   } catch (e) {
 *     if (e instanceof ConflictError) { ... }
 *     else throw e
 *   }
 */

'use client'

import { createClient } from '@/lib/supabase/client'

export class ConflictError extends Error {
  public readonly isConflict = true
  constructor(
    public readonly table: string,
    public readonly id: string,
  ) {
    super(`Conflict on ${table}#${id}: 다른 디바이스가 먼저 수정함`)
    this.name = 'ConflictError'
  }
}

export function isConflictError(e: unknown): e is ConflictError {
  return e instanceof ConflictError ||
    (typeof e === 'object' && e !== null && 'isConflict' in e && e.isConflict === true)
}

export interface SafeUpdateOpts<T extends Record<string, unknown>> {
  table: string
  id: string
  patch: T
  knownUpdatedAt: string
  /** updated_at 조건 없이 강제로 덮어쓰기 (drag-drop 등 명백히 사용자 의도가 우선일 때) */
  force?: boolean
}

export interface SafeUpdateResult {
  updated_at: string
}

/**
 * 충돌 감지 update.
 * @throws ConflictError — 다른 디바이스/탭이 먼저 수정함
 * @throws Error — 일반 DB 에러
 */
export async function safeUpdate<T extends Record<string, unknown>>(
  opts: SafeUpdateOpts<T>,
): Promise<SafeUpdateResult> {
  const supabase = createClient()
  // opts.table이 동적 string이라 supabase가 테이블별 타입을 추론하지 못함 → patch 캐스팅 우회
  let qb = supabase.from(opts.table).update(opts.patch as never).eq('id', opts.id)
  if (!opts.force) {
    qb = qb.eq('updated_at', opts.knownUpdatedAt)
  }
  const { data, error } = await qb.select('updated_at').maybeSingle()

  if (error) {
    // PGRST116 (No rows returned) — 일부 supabase 버전에서 maybeSingle도 emit 가능
    if (error.code === 'PGRST116') {
      throw new ConflictError(opts.table, opts.id)
    }
    throw error
  }
  if (!data) {
    // updated_at mismatch → 0 row 영향 → null return
    throw new ConflictError(opts.table, opts.id)
  }

  return { updated_at: (data as { updated_at: string }).updated_at }
}

/**
 * 충돌 시에도 호출자가 별도 처리 안 하고 단순히 “강제 덮어쓰기”하고 싶을 때 사용.
 * 충돌 발생하면 force=true로 한 번 더 시도.
 */
export async function safeUpdateOrForce<T extends Record<string, unknown>>(
  opts: SafeUpdateOpts<T>,
  onConflict?: () => void,
): Promise<SafeUpdateResult> {
  try {
    return await safeUpdate(opts)
  } catch (e) {
    if (isConflictError(e)) {
      onConflict?.()
      return await safeUpdate({ ...opts, force: true })
    }
    throw e
  }
}
