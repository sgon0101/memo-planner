/**
 * 오프라인 상태 + 큐 동기화 진행 표시 배너 (PR-M1-A).
 *
 * 표시 조건:
 *   - 오프라인이면 항상 (대기 큐 0개여도): "오프라인"
 *   - 온라인 + 큐 > 0: "N개 동기화 중" (회전 아이콘)
 *   - 온라인 + 큐 0: 표시 안 함
 *
 * 위치: 상단 고정 (z-200 — modal보다 위, toast보다 위)
 */

'use client'

import { WifiOff, RefreshCw } from 'lucide-react'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { useQueueStatus } from '@/hooks/useQueueStatus'
import { cn } from '@/lib/utils'

export function OfflineBanner() {
  const online = useOnlineStatus()
  const { pendingCount } = useQueueStatus()

  // 온라인 + 큐 0 = 숨김
  if (online && pendingCount === 0) return null

  const isFlushing = online && pendingCount > 0

  return (
    <div
      className={cn(
        'fixed top-2 left-1/2 -translate-x-1/2 flex items-center gap-1.5',
        'px-3 py-1.5 rounded-full text-xs font-medium shadow-md',
        'transition-colors duration-200',
        isFlushing
          ? 'bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-200 border border-blue-200 dark:border-blue-800'
          : 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-200 border border-amber-200 dark:border-amber-800'
      )}
      style={{ zIndex: 200 }}
      role="status"
      aria-live="polite"
    >
      {isFlushing ? (
        <>
          <RefreshCw size={12} className="animate-spin" />
          <span>{pendingCount}개 동기화 중...</span>
        </>
      ) : (
        <>
          <WifiOff size={12} />
          <span>오프라인{pendingCount > 0 ? ` — ${pendingCount}개 저장 대기` : ''}</span>
        </>
      )}
    </div>
  )
}
