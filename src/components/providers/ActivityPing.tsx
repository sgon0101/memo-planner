/**
 * 리텐션 측정용 "앱 열기" 신호 (2026-10-18, 0022_retention_tracking).
 *
 * 쓰기(메모·플랜·AI 등)는 DB 트리거가 수집하고, 읽기만 한 날도 활성으로 치기 위해
 * 열기 신호만 여기서 보낸다. 내용은 보내지 않는다 — RPC가 그날 opens 횟수만 올린다.
 *
 * - 하루(KST) 1회: `weave-<uid>-last-open-day`가 오늘이면 호출하지 않는다 (계정 삭제 시 지워지는 키 패턴)
 * - PWA를 켜둔 채 날짜가 바뀌는 경우: 화면 복귀(visibilitychange)·온라인 복귀 때 다시 확인
 * - 실패는 조용히 무시 (토스트·Sentry 없음) — 다음 기회에 다시 시도
 */

'use client'

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { subscribeUserId } from '@/lib/auth/currentUser'
import { lsLastOpenDay } from '@/lib/cache/lsKeys'

const kstDayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
})

export function ActivityPing() {
  useEffect(() => {
    let uid: string | null = null
    let inFlight = false

    async function ping() {
      if (!uid || inFlight || document.visibilityState !== 'visible' || !navigator.onLine) return
      const key = lsLastOpenDay()
      if (!key) return
      const today = kstDayFormatter.format(new Date())
      try { if (localStorage.getItem(key) === today) return } catch { /* 저장소 차단 — 그냥 호출 */ }

      inFlight = true
      try {
        const { error } = await createClient().rpc('track_open')
        if (!error) {
          try { localStorage.setItem(key, today) } catch { /* ignore */ }
        }
      } catch { /* 다음 기회에 */ } finally {
        inFlight = false
      }
    }

    const unsubscribe = subscribeUserId((next) => {
      uid = next
      void ping()
    })
    const onVisible = () => { if (document.visibilityState === 'visible') void ping() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onVisible)
    return () => {
      unsubscribe()
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onVisible)
    }
  }, [])

  return null
}
