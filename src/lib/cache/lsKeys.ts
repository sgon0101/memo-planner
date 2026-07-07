/**
 * localStorage 키 단일 출처.
 *
 * 모든 user-specific 캐시 키는 buildUserCacheKey()로 namespacing.
 * userId가 없으면 null 반환 → 호출자가 cache write/read 자체를 skip.
 *
 * 사용 예:
 *   const k = lsMemosCache(); if (!k) return
 *   localStorage.setItem(k, JSON.stringify(memos))
 *
 * 보존 키 (사용자 취향, namespacing 불필요):
 *   - memoPanelOpen, memo-card-cols, weave:md_hint_dismissed
 *   - weave-notif-enabled, weave-notif-lead-min
 */

import { buildUserCacheKey } from '@/lib/auth/currentUser'

// ─── 메모 ────────────────────────────────────────────────────────────────
export const lsMemosCache       = (): string | null => buildUserCacheKey('memos-cache')
export const lsMemosCacheTs     = (): string | null => buildUserCacheKey('memos-cache-ts')
export const lsMemosTotalCount  = (): string | null => buildUserCacheKey('memos-total-count')

// ─── 플랜 ────────────────────────────────────────────────────────────────
export const lsPlansCache       = (): string | null => buildUserCacheKey('plans-cache')
export const lsPlansCacheTs     = (): string | null => buildUserCacheKey('plans-cache-ts')

// ─── 그래프 ──────────────────────────────────────────────────────────────
export const lsGraphAnalyzeCache   = (): string | null => buildUserCacheKey('graph-analyze-cache')
export const lsGraphAnalyzeCacheTs = (): string | null => buildUserCacheKey('graph-analyze-cache-ts')

// ─── 홈 ──────────────────────────────────────────────────────────────────
export const lsHomeMemosCache   = (): string | null => buildUserCacheKey('home-memos-cache')
export const lsHomeMemosCacheTs = (): string | null => buildUserCacheKey('home-memos-cache-ts')
export const lsHomeStatsCache   = (): string | null => buildUserCacheKey('home-stats-cache')
export const lsHomeStatsCacheTs = (): string | null => buildUserCacheKey('home-stats-cache-ts')

// ─── 백업/설정 ────────────────────────────────────────────────────────────
export const lsLastDriveBackup  = (): string | null => buildUserCacheKey('last-drive-backup')
export const lsRealtimeSync     = (): string | null => buildUserCacheKey('realtime-sync')

/** 모든 user-specific 키 일괄 제거 (clearUserNamespace로도 처리되지만, 명시적 제거가 필요한 곳용) */
export function getAllUserCacheKeys(): (string | null)[] {
  return [
    lsMemosCache(), lsMemosCacheTs(), lsMemosTotalCount(),
    lsPlansCache(), lsPlansCacheTs(),
    lsGraphAnalyzeCache(), lsGraphAnalyzeCacheTs(),
    lsHomeMemosCache(), lsHomeMemosCacheTs(),
    lsHomeStatsCache(), lsHomeStatsCacheTs(),
    lsLastDriveBackup(), lsRealtimeSync(),
  ]
}
