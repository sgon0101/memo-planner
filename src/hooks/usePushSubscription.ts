'use client'

/**
 * Web Push 구독 관리 hook (#6-B)
 *
 * - 권한 + 등록 상태 노출
 * - subscribe(): Notification 권한 요청 → SW 구독 생성 → 서버에 저장
 * - unsubscribe(): SW 구독 해제 → 서버에서 삭제
 *
 * Service Worker 등록은 ServiceWorkerRegister에서 이미 이루어짐을 가정.
 */

import { useCallback, useEffect, useState } from 'react'

const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ''

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(normalized)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export type PushPermission = 'unsupported' | 'default' | 'granted' | 'denied'

export function usePushSubscription() {
  const [permission, setPermission] = useState<PushPermission>('default')
  const [subscribed, setSubscribed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 환경 점검 + 현재 구독 상태 확인
  useEffect(() => {
    let cancelled = false
    async function check() {
      if (typeof window === 'undefined') return
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        if (!cancelled) setPermission('unsupported')
        return
      }
      if (!cancelled) setPermission(Notification.permission as PushPermission)
      try {
        const reg = await navigator.serviceWorker.ready
        const existing = await reg.pushManager.getSubscription()
        if (!cancelled) setSubscribed(!!existing)
      } catch {
        if (!cancelled) setSubscribed(false)
      }
    }
    check()
    return () => { cancelled = true }
  }, [])

  const subscribe = useCallback(async (): Promise<boolean> => {
    setError(null)
    if (permission === 'unsupported') {
      setError('이 브라우저는 Web Push를 지원하지 않아요.')
      return false
    }
    if (!VAPID_PUBLIC) {
      setError('서버에 VAPID 키가 설정되지 않았어요.')
      return false
    }
    setLoading(true)
    try {
      // 1) 권한 요청
      const perm = await Notification.requestPermission()
      setPermission(perm as PushPermission)
      if (perm !== 'granted') {
        setError('알림 권한이 거부됐어요. 브라우저 설정에서 허용해주세요.')
        return false
      }
      // 2) SW 준비
      const reg = await navigator.serviceWorker.ready
      // 3) 기존 구독 있으면 재사용, 없으면 새로
      let sub = await reg.pushManager.getSubscription()
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC) as unknown as BufferSource,
        })
      }
      // 4) 서버에 저장
      const res = await fetch('/api/notifications/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...sub.toJSON(),
          userAgent: navigator.userAgent,
        }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error ?? `서버 등록 실패 (${res.status})`)
      }
      setSubscribed(true)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : '구독 실패')
      return false
    } finally {
      setLoading(false)
    }
  }, [permission])

  const unsubscribe = useCallback(async (): Promise<boolean> => {
    setError(null)
    setLoading(true)
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        // 서버 먼저 삭제 (endpoint 기준)
        await fetch('/api/notifications/unsubscribe', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        }).catch(() => {})
        await sub.unsubscribe()
      }
      setSubscribed(false)
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : '해제 실패')
      return false
    } finally {
      setLoading(false)
    }
  }, [])

  return { permission, subscribed, loading, error, subscribe, unsubscribe }
}
