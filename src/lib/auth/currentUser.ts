/**
 * 현재 사용자 ID 추적 + 로그아웃 시 localStorage 청소.
 *
 * 왜 필요한가:
 *   - useMemos 등 localStorage 캐시가 userId namespacing 없이 단일 키 사용 중.
 *   - 같은 브라우저에서 다른 계정으로 로그인하면 이전 사용자 메모가 잠시 노출됨.
 */

'use client'

import type { SupabaseClient } from '@supabase/supabase-js'

let cachedUserId: string | null = null
let initialized = false
let unsubscribeFn: (() => void) | null = null

// userId 변경 구독자 — React 훅에서 reactive하게 받기 위함
const subscribers = new Set<(uid: string | null) => void>()
function notify() {
  subscribers.forEach((fn) => { try { fn(cachedUserId) } catch { /* ignore */ } })
}

/** userId 변경 구독 — return된 함수로 unsubscribe.
 *  구독 즉시 현재 값으로 callback 1회 실행. */
export function subscribeUserId(fn: (uid: string | null) => void): () => void {
  subscribers.add(fn)
  try { fn(cachedUserId) } catch { /* ignore */ }
  return () => { subscribers.delete(fn) }
}

export function getCurrentUserId(): string | null {
  return cachedUserId
}

export async function initCurrentUser(supabase: SupabaseClient): Promise<void> {
  if (initialized) return
  initialized = true

  try {
    const { data: { user } } = await supabase.auth.getUser()
    cachedUserId = user?.id ?? null
  } catch {
    cachedUserId = null
  }
  notify()  // 초기화 완료 알림

  const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
    const newUserId = session?.user?.id ?? null
    const prevUserId = cachedUserId

    if (event === 'SIGNED_OUT' || (prevUserId && prevUserId !== newUserId)) {
      if (prevUserId) clearUserNamespace(prevUserId)
      clearLegacyCaches()
    }

    cachedUserId = newUserId
    notify()
  })

  unsubscribeFn = () => subscription.unsubscribe()
}

export function disposeCurrentUser(): void {
  unsubscribeFn?.()
  unsubscribeFn = null
  cachedUserId = null
  initialized = false
}

export function clearUserNamespace(userId: string): void {
  if (typeof window === 'undefined') return
  const prefix = `weave-${userId}-`
  try {
    const keys = Object.keys(localStorage)
    for (const k of keys) {
      if (k.startsWith(prefix)) localStorage.removeItem(k)
    }
  } catch { /* ignore */ }
}

/**
 * 비-namespaced user-specific 캐시 키 청소.
 * 보존 대상: memoPanelOpen, memo-card-cols, weave:md_hint_dismissed,
 *           weave-notif-enabled, weave-notif-lead-min (UI 취향)
 */
export function clearLegacyCaches(): void {
  if (typeof window === 'undefined') return
  const legacyKeys = [
    'memos-all-cache', 'memos-all-cache-ts',
    'memos-total-count',
    'home-memos-cache', 'home-memos-cache-ts',
    'home-stats-cache', 'home-stats-cache-ts',
    'lastDriveBackup',
  ]
  try {
    for (const k of legacyKeys) localStorage.removeItem(k)
  } catch { /* ignore */ }
}

export function clearAllUserCaches(): void {
  if (cachedUserId) clearUserNamespace(cachedUserId)
  clearLegacyCaches()
}

export function buildUserCacheKey(suffix: string): string | null {
  const uid = getCurrentUserId()
  if (!uid) return null
  return `weave-${uid}-${suffix}`
}
