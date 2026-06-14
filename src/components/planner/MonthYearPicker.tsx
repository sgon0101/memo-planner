'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * MonthYearPicker — 캘린더 헤더에서 월/연도 빠른 점프
 *
 * 12개월 그리드 + 연도 ◀▶ 버튼.
 * Portal로 띄우고 anchorRect 기준으로 자동 flip.
 */

const MONTH_LABELS = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월']

interface Props {
  anchorRect: DOMRect
  currentDate: Date
  /** 오늘 강조용 */
  today: Date
  onSelect: (date: Date) => void
  onClose: () => void
}

const PANEL_W = 260

export default function MonthYearPicker({
  anchorRect, currentDate, today, onSelect, onClose,
}: Props) {
  const [year, setYear] = useState(currentDate.getFullYear())
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  // 위치 계산 + flip
  useLayoutEffect(() => {
    function calc() {
      const vw = window.innerWidth
      const vh = window.innerHeight
      const ph = panelRef.current?.offsetHeight ?? 280
      let top = anchorRect.bottom + 6
      if (top + ph > vh - 8) top = anchorRect.top - ph - 6
      let left = anchorRect.left
      if (left + PANEL_W > vw - 8) left = vw - PANEL_W - 8
      if (left < 8) left = 8
      setPos({ top, left })
    }
    calc()
    const raf = requestAnimationFrame(calc)
    window.addEventListener('resize', calc)
    window.addEventListener('scroll', calc, true)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', calc)
      window.removeEventListener('scroll', calc, true)
    }
  }, [anchorRect])

  // 외부 클릭 / Esc 닫기
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      const t = e.target as Node
      if (panelRef.current?.contains(t)) return
      onClose()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.stopPropagation(); onClose() }
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const currentY = currentDate.getFullYear()
  const currentM = currentDate.getMonth()
  const todayY = today.getFullYear()
  const todayM = today.getMonth()

  function pick(month: number) {
    onSelect(new Date(year, month, 1))
    onClose()
  }

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label="월/연도 선택"
      style={{
        position: 'fixed',
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        width: PANEL_W,
        zIndex: 200,
        visibility: pos ? 'visible' : 'hidden',
      }}
      className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl p-3 modal-panel-enter"
    >
      {/* 연도 네비 */}
      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          onClick={() => setYear((y) => y - 1)}
          aria-label="이전 연도"
          className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
        >
          <ChevronLeft size={14} />
        </button>
        <button
          type="button"
          onClick={() => setYear(todayY)}
          className="px-3 py-1 text-sm font-semibold text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
          title="올해로"
        >
          {year}년
        </button>
        <button
          type="button"
          onClick={() => setYear((y) => y + 1)}
          aria-label="다음 연도"
          className="p-1.5 rounded-md text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
        >
          <ChevronRight size={14} />
        </button>
      </div>

      {/* 12개월 그리드 */}
      <div className="grid grid-cols-3 gap-1">
        {MONTH_LABELS.map((label, m) => {
          const isCurrent = year === currentY && m === currentM
          const isToday = year === todayY && m === todayM
          return (
            <button
              key={m}
              type="button"
              onClick={() => pick(m)}
              className={cn(
                'py-2 text-sm rounded-md transition-colors cursor-pointer',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500',
                isCurrent
                  ? 'bg-violet-600 text-white font-semibold'
                  : isToday
                    ? 'bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 font-medium'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800',
              )}
              aria-pressed={isCurrent}
            >
              {label}
            </button>
          )
        })}
      </div>
    </div>,
    document.body,
  )
}
