'use client'

/**
 * Quick Capture Floating Action Button
 *
 * - 데스크탑: 우하단 (sidebar 영역 아래) — 작게
 * - 모바일: 우하단 MobileNav 위 — 크게 (엄지로 닿기 쉬운 위치)
 *
 * 클릭 시 QuickCaptureModal 오픈.
 */

import { Plus } from 'lucide-react'
import { useUIStore } from '@/store/uiStore'
import { cn } from '@/lib/utils'

export default function QuickCaptureFAB() {
  const open = useUIStore((s) => s.openQuickCapture)
  const modalOpen = useUIStore((s) => s.quickCaptureOpen)

  // 모달 열려있을 땐 FAB 숨김
  if (modalOpen) return null

  return (
    <button
      onClick={() => open()}
      className={cn(
        'fixed z-40 flex items-center justify-center rounded-full bg-violet-600 hover:bg-violet-700 text-white shadow-lg shadow-violet-500/30 transition-all active:scale-95',
        // 모바일 — bottom-nav(h-14) 위 + safe-area 고려
        'bottom-20 right-4 w-14 h-14',
        // 데스크탑 — 작고 우하단
        'md:bottom-6 md:right-6 md:w-12 md:h-12',
      )}
      aria-label="빠른 캡처 (Ctrl+Shift+K)"
      title="빠른 캡처 (Ctrl+Shift+K)"
    >
      <Plus size={22} strokeWidth={2.5} />
    </button>
  )
}
