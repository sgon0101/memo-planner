/**
 * 현재 사용자 ID 추적 + 로그아웃 시 localStorage 청소.
 *
 * 왜 필요한가:
 *   - useMemos 등 localStorage 캐시가 userId namespacing 없이 단일 키 사용 중.
 *   - 같은 브라우저에서 다른 계정으로 로그인하면 이전 사용자 메모가 잠시 노출됨.
 */

'use client'

import type { SupabaseClient } from '@supabase/supabase-js'
import { markStartup } from '@/lib/perf/startupTrace'

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

/** 로그인 쿠키(sb-<ref>-auth-token, 나뉘어 저장되면 .0 .1 …)에서 userId를 네트워크 없이 읽는다.
 *  검증용이 아니라 이 브라우저에 저장된 캐시 위치를 찾는 용도 — 실제 확인은 getSession()이 한다. */
function readUserIdFromCookie(): string | null {
  if (typeof document === 'undefined') return null
  try {
    const parts: { idx: number; val: string }[] = []
    for (const c of document.cookie.split('; ')) {
      const eq = c.indexOf('=')
      const name = c.slice(0, eq)
      const m = /^sb-[^.]+-auth-token(?:\.(\d+))?$/.exec(name)
      if (m) parts.push({ idx: m[1] ? Number(m[1]) : -1, val: decodeURIComponent(c.slice(eq + 1)) })
    }
    if (parts.length === 0) return null
    parts.sort((a, b) => a.idx - b.idx)
    let raw = parts.map((p) => p.val).join('')
    if (raw.startsWith('base64-')) {
      const b64 = raw.slice(7).replace(/-/g, '+').replace(/_/g, '/')
      const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
      raw = new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)))
    }
    const parsed = JSON.parse(raw) as { user?: { id?: unknown } } | unknown[]
    const id = Array.isArray(parsed) ? null : parsed.user?.id
    return typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id) ? id : null
  } catch {
    return null
  }
}

export function getCurrentUserId(): string | null {
  return cachedUserId
}

export async function initCurrentUser(supabase: SupabaseClient): Promise<void> {
  if (initialized) return
  initialized = true

  // 로그인 쿠키에서 userId를 먼저 읽어 바로 알린다 — 몇 시간 뒤 열면 액세스 토큰이 만료돼
  // getSession()이 Supabase에 토큰 갱신을 다녀올 때까지 기다리고, 그동안 userId가 없어
  // 홈이 저장된 캐시(메모·이번 주 플랜)를 못 읽고 빈 화면으로 있었다. userId는 만료와 무관하게 같다.
  const quickId = readUserIdFromCookie()
  if (quickId) {
    cachedUserId = quickId
    notify()
    markStartup('userId')
  }

  try {
    // getUser()는 토큰 refresh fetch를 시도해 offline에서 throw → namespace 캐시 실패
    // getSession()은 cookie/localStorage sync 읽기라 offline-safe
    const { data: { session } } = await supabase.auth.getSession()
    const sessionId = session?.user?.id ?? null
    // 쿠키로 먼저 알린 값과 다르면(다른 계정·로그아웃) 이전 사용자 캐시를 정리
    if (quickId && quickId !== sessionId) clearUserNamespace(quickId)
    cachedUserId = sessionId
  } catch {
    // 오프라인 등 일시 오류 — 쿠키에서 읽은 값을 유지
    cachedUserId = quickId
  }
  notify()  // 초기화 완료 알림
  markStartup('token')
  if (cachedUserId) markStartup('userId')

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
