'use client'

/**
 * 알림 스케줄러 백그라운드 컴포넌트
 *
 * - layout에서 mount됨
 * - 활성화 상태일 때만 동작
 * - 페이지 진입/포커스/30분 interval로 refreshScheduled() 호출
 */

import { useEffect } from 'react'
import { refreshScheduled, isNotifEnabled, clearAllTimers } from '@/lib/notifications/scheduler'

export default function NotificationScheduler() {
  useEffect(() => {
    if (!isNotifEnabled()) return

    // 초기 진입 시 한 번 (mount 직후)
    refreshScheduled().catch(() => {})

    // 30분마다 (visibilitychange도 트리거)
    const interval = setInterval(() => {
      if (isNotifEnabled()) refreshScheduled().catch(() => {})
    }, 30 * 60 * 1000)

    // 페이지 visible 전환 시 (탭 복귀)
    function onVisible() {
      if (document.visibilityState === 'visible' && isNotifEnabled()) {
        refreshScheduled().catch(() => {})
      }
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
      clearAllTimers()
    }
  }, [])

  return null
}
