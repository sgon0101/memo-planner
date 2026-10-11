'use client'

/**
 * CSS 미디어쿼리 구독 훅 — SSR에선 serverDefault, 하이드레이션 후 실제 값으로 갱신.
 * useSyncExternalStore라 하이드레이션 불일치 경고 없이 동작한다.
 */

import { useCallback, useSyncExternalStore } from 'react'

export function useMediaQuery(query: string, serverDefault = false): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mql = window.matchMedia(query)
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    },
    [query],
  )
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => serverDefault,
  )
}

/** Tailwind `md` 브레이크포인트(768px) 이상 */
export function useIsDesktop(): boolean {
  return useMediaQuery('(min-width: 768px)')
}
