'use client'

import { useState, useRef } from 'react'
import { Calendar, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import CalendarPicker from './CalendarPicker'

interface Props {
  startDate: string | null
  endDate: string | null
  onDateRangeApply: (start: string | null, end: string | null) => void
  allMonths: string[]
  activeMonth: string | null
  onMonthChange: (month: string | null) => void
  onClearFilter: () => void
}

type Tab = 'range' | 'month'
type CalTarget = 'start' | 'end' | null

export default function TimelineFilter({
  startDate, endDate, onDateRangeApply,
  allMonths, activeMonth, onMonthChange, onClearFilter,
}: Props) {
  const [tab, setTab] = useState<Tab>('month')
  const [pendingStart, setPendingStart] = useState<string | null>(startDate)
  const [pendingEnd, setPendingEnd] = useState<string | null>(endDate)
  const [calTarget, setCalTarget] = useState<CalTarget>(null)
  const [calPos, setCalPos] = useState({ x: 0, y: 0 })
  const startBtnRef = useRef<HTMLButtonElement>(null)
  const endBtnRef = useRef<HTMLButtonElement>(null)

  const isRangeActive = !!(startDate || endDate)
  const isMonthActive = !!activeMonth

  function openCal(target: CalTarget, btnRef: React.RefObject<HTMLButtonElement | null>) {
    if (!btnRef.current) return
    const rect = btnRef.current.getBoundingClientRect()
    setCalPos({ x: rect.left, y: rect.bottom })
    setCalTarget(target)
  }

  function handleApply() {
    onDateRangeApply(pendingStart, pendingEnd)
  }

  function handleClear() {
    setPendingStart(null)
    setPendingEnd(null)
    onClearFilter()
  }

  function formatDisplay(d: string | null) {
    if (!d) return '날짜 선택'
    return d.replace(/-/g, '.').slice(0, 10)
  }

  return (
    <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
      {/* 활성 필터 배너 */}
      {(isRangeActive || isMonthActive) && (
        <div className="flex items-center gap-2 px-4 py-1.5 bg-violet-50 dark:bg-violet-950/20 border-b border-violet-100 dark:border-violet-900/30">
          <span className="text-xs text-violet-600 dark:text-violet-400 flex-1 truncate">
            {isMonthActive
              ? `${activeMonth!.replace('-', '.')} 필터 중`
              : `${(startDate ?? '').replace(/-/g, '.')} ~ ${(endDate ?? '').replace(/-/g, '.')} 필터 중`
            }
          </span>
          <button onClick={onClearFilter} className="text-xs text-violet-500 hover:text-violet-700 flex items-center gap-0.5 flex-shrink-0">
            <X size={11} /> 해제
          </button>
        </div>
      )}

      {/* 탭 */}
      <div className="flex gap-1 px-4 pt-2">
        {([
          { key: 'month', label: '월별 빠른 선택' },
          { key: 'range', label: '기간 직접 설정' },
        ] as const).map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              'text-xs px-3 py-1 rounded-full border transition-colors',
              tab === key
                ? 'border-violet-500 bg-violet-50 dark:bg-violet-950/30 text-violet-600 dark:text-violet-400'
                : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300'
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 탭 1: 월별 빠른 선택 */}
      {tab === 'month' && (
        <div className="flex items-center gap-1.5 px-4 py-2 overflow-x-auto scrollbar-none">
          <button
            onClick={() => onMonthChange(null)}
            className={cn(
              'flex-shrink-0 text-xs px-2.5 py-1 rounded-full border transition-colors',
              !activeMonth
                ? 'border-violet-500 bg-violet-50 dark:bg-violet-950/30 text-violet-600 dark:text-violet-400'
                : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300'
            )}
          >
            전체
          </button>
          {allMonths.map((m) => (
            <button
              key={m}
              onClick={() => onMonthChange(activeMonth === m ? null : m)}
              className={cn(
                'flex-shrink-0 text-xs px-2.5 py-1 rounded-full border transition-colors',
                activeMonth === m
                  ? 'border-violet-500 bg-violet-50 dark:bg-violet-950/30 text-violet-600 dark:text-violet-400'
                  : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300'
              )}
            >
              {m.replace('-', '.')}
            </button>
          ))}
        </div>
      )}

      {/* 탭 2: 기간 직접 설정 */}
      {tab === 'range' && (
        <div className="px-4 py-2">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              ref={startBtnRef}
              onClick={() => openCal('start', startBtnRef)}
              className={cn(
                'flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors',
                pendingStart
                  ? 'border-violet-400 bg-violet-50 dark:bg-violet-950/20 text-violet-600 dark:text-violet-400'
                  : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300'
              )}
            >
              <Calendar size={12} />
              {formatDisplay(pendingStart)}
            </button>
            <span className="text-xs text-gray-400">~</span>
            <button
              ref={endBtnRef}
              onClick={() => openCal('end', endBtnRef)}
              className={cn(
                'flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors',
                pendingEnd
                  ? 'border-violet-400 bg-violet-50 dark:bg-violet-950/20 text-violet-600 dark:text-violet-400'
                  : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300'
              )}
            >
              <Calendar size={12} />
              {formatDisplay(pendingEnd)}
            </button>
            <button
              onClick={handleApply}
              disabled={!pendingStart && !pendingEnd}
              className="text-xs px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg transition-colors disabled:opacity-40"
            >
              적용
            </button>
            <button
              onClick={handleClear}
              className="text-xs px-2.5 py-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
            >
              초기화
            </button>
          </div>
        </div>
      )}

      {/* 달력 팝업 */}
      {calTarget === 'start' && (
        <CalendarPicker
          value={pendingStart}
          rangeStart={pendingStart}
          rangeEnd={pendingEnd}
          position={calPos}
          onSelect={(d) => { setPendingStart(d); if (pendingEnd && d > pendingEnd) setPendingEnd(null) }}
          onClose={() => setCalTarget(null)}
        />
      )}
      {calTarget === 'end' && (
        <CalendarPicker
          value={pendingEnd}
          minDate={pendingStart}
          rangeStart={pendingStart}
          rangeEnd={pendingEnd}
          position={calPos}
          onSelect={(d) => setPendingEnd(d)}
          onClose={() => setCalTarget(null)}
        />
      )}
    </div>
  )
}
