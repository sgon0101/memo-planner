/**
 * navigator.onLine 구독 (PR-M1-A).
 *
 * 사용:
 *   const online = useOnlineStatus()
 *   if (!online) toast('오프라인')
 *
 * - SSR에서는 항상 true (서버 측에서 onLine 알 수 없음)
 * - online/offline 이벤트 자동 구독
 */

'use client'

import { useEffect, useState } from 'react'

export function useOnlineStatus(): boolean {
  // 초기값 true 고정 (#418 방지) — Node 21+/서버 런타임에도 navigator 글로벌이
  // 존재해 `typeof navigator !== 'undefined'`가 서버에서 true가 되고,
  // navigator.onLine은 undefined → false로 평가되어 SSR이 오프라인 배너를
  // 렌더하던 문제. 실값은 아래 effect가 mount 직후 동기화한다.
  const [online, setOnline] = useState<boolean>(true)

  useEffect(() => {
    const onOnline = () => setOnline(true)
    const onOffline = () => setOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    // mount 시 한 번 더 동기화 (예: dev tools에서 강제 변경 직후)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 외부 시스템(navigator.onLine) mount 동기화 (의도 패턴)
    setOnline(navigator.onLine)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  return online
}
