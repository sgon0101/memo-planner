'use client'

import { clearAllUserCaches, clearLegacyCaches } from '@/lib/auth/currentUser'
import { clearAllOfflineData } from '@/lib/sync/queueDB'

/**
 * 계정 삭제 직후 이 브라우저에 남은 사용자 데이터를 지운다.
 * 각 단계는 독립적으로 실패를 삼킨다 — 서버 삭제는 이미 끝났으므로 여기서 멈추면 안 된다.
 *
 * 남기는 것: 기기 취향(다크모드 memo-planner-ui, memoPanelOpen, memo-card-cols,
 *            weave-notif-*, weave:md_hint_dismissed, weave:graph-settings-open)
 */

// 네임스페이스 밖에 있는 사용자 데이터성 키
const USER_DATA_KEYS = ['memo-folder-selection', 'weave:planner-last-sync', 'weave:memo-list-filters']
// `weave-${uuid}-…` — cachedUserId가 비어 있어도 지울 수 있게 형식으로 찾는다
const NAMESPACED_RE = /^weave-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/

export async function clearLocalAccountData(): Promise<void> {
  try {
    clearAllUserCaches()
    clearLegacyCaches()
    for (const k of Object.keys(localStorage)) {
      if (NAMESPACED_RE.test(k) || USER_DATA_KEYS.includes(k)) localStorage.removeItem(k)
    }
  } catch { /* ignore */ }

  try { sessionStorage.clear() } catch { /* ignore */ }

  // 오프라인 큐·이미지 blob (IndexedDB)
  await clearAllOfflineData().catch((err) => console.error('[account] 오프라인 큐 정리 실패', err))

  // SW가 network-first로 저장한 HTML 페이지에 사용자 내용이 들어 있을 수 있다
  try {
    if ('caches' in window) {
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
    }
  } catch { /* ignore */ }

  // 브라우저 푸시 구독 (서버 행은 CASCADE로 이미 삭제됨)
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.getRegistration()
      const sub = await reg?.pushManager.getSubscription()
      await sub?.unsubscribe()
    }
  } catch { /* ignore */ }
}
