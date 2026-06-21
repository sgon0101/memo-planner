/**
 * 현재 사용자 ID를 React 상태로 reactive하게 반환.
 *
 * - initCurrentUser가 끝나기 전 mount된 컴포넌트도 userId가 set되면 자동 re-render.
 * - 로그아웃/계정 전환 시 자동으로 새 값(null 또는 다른 uid) 전달.
 *
 * 사용:
 *   const userId = useCurrentUserId()
 *   useEffect(() => {
 *     if (!userId) return
 *     // subscribe to realtime / etc.
 *   }, [userId])
 */

'use client'

import { useEffect, useState } from 'react'
import { getCurrentUserId, subscribeUserId } from '@/lib/auth/currentUser'

export function useCurrentUserId(): string | null {
  const [uid, setUid] = useState<string | null>(() => getCurrentUserId())
  useEffect(() => subscribeUserId(setUid), [])
  return uid
}
