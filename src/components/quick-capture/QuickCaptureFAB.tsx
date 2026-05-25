'use client'

/**
 * Quick Capture FAB (Speed Dial)
 *
 * 디자인 의도:
 *  - 단일 탭 → 메모/플랜 미니 버튼 두 개로 펼침
 *  - 미니 버튼 탭 → 해당 모드로 모달 오픈 (탭 한 번 줄어듦)
 *  - 외부 탭/Esc/백드롭 탭 → 닫힘
 *  - 펼친 상태에서 메인 버튼은 45도 회전 (+ → ✕ 시각 변형)
 *
 * 위치:
 *  - 모바일: bottom-20 (MobileNav h-14 위) + right-4
 *  - 데스크탑: bottom-6 right-6, 좀 더 작게
 */

import { useEffect, useRef, useState } from 'react'
import { Plus, FileText, Calendar } from 'lucide-react'
import { useUIStore } from '@/store/uiStore'
import { cn } from '@/lib/utils'

export default function QuickCaptureFAB() {
  const open = useUIStore((s) => s.openQuickCapture)
  const modalOpen = useUIStore((s) => s.quickCaptureOpen)
  const [expanded, setExpanded] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (modalOpen && expanded) setExpanded(false)
  }, [modalOpen, expanded])

  useEffect(() => {
    if (!expanded) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setExpanded(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expanded])

  function handleSelect(mode: 'memo' | 'plan') {
    setExpanded(false)
    requestAnimationFrame(() => open(mode))
  }

  if (modalOpen) return null

  return (
    <>
      {expanded && (
        <div
          className="fixed inset-0 z-30 bg-black/30 backdrop-blur-[2px]"
          onClick={() => setExpanded(false)}
          aria-hidden
        />
      )}

      <div
        ref={wrapperRef}
        className="fixed z-40 bottom-20 right-4 md:bottom-6 md:right-6 flex flex-col items-end gap-2.5"
      >
        <div
          className={cn(
            'flex flex-col items-end gap-2 transition-all duration-200 origin-bottom-right',
            expanded
              ? 'opacity-100 translate-y-0 scale-100 pointer-events-auto'
              : 'opacity-0 translate-y-3 scale-90 pointer-events-none',
          )}
        >
          <SubButton
            icon={<FileText size={15} />}
            label="메모"
            accent="bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-400"
            onClick={() => handleSelect('memo')}
          />
          <SubButton
            icon={<Calendar size={15} />}
            label="플랜"
            accent="bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400"
            onClick={() => handleSelect('plan')}
          />
        </div>

        <button
          onClick={() => setExpanded((v) => !v)}
          className={cn(
            'flex items-center justify-center rounded-full bg-violet-600 hover:bg-violet-700 text-white shadow-lg shadow-violet-500/30 transition-all active:scale-95',
            'w-14 h-14 md:w-12 md:h-12',
            expanded && 'rotate-45',
          )}
          aria-label={expanded ? '캡처 메뉴 닫기' : '빠른 캡처 (메모/플랜)'}
          aria-expanded={expanded}
        >
          <Plus size={22} strokeWidth={2.5} />
        </button>
      </div>
    </>
  )
}

function SubButton({
  icon, label, accent, onClick,
}: {
  icon: React.ReactNode
  label: string
  accent: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2.5 pl-2 pr-4 py-2 rounded-full bg-white dark:bg-gray-800 shadow-lg border border-gray-100 dark:border-gray-700 text-sm font-medium text-gray-800 dark:text-gray-200 active:scale-95 hover:bg-gray-50 transition-all"
    >
      <span className={cn('w-8 h-8 rounded-full flex items-center justify-center', accent)}>
        {icon}
      </span>
      {label}
    </button>
  )
}
