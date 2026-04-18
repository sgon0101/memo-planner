'use client'

import { useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval,
  getDay, isSameDay, parseISO, addMonths, subMonths,
  isAfter, isBefore,
} from 'date-fns'
import { ko } from 'date-fns/locale'
import { cn } from '@/lib/utils'

interface Props {
  value: string | null
  minDate?: string | null
  rangeStart?: string | null
  rangeEnd?: string | null
  position: { x: number; y: number }
  onSelect: (date: string) => void
  onClose: () => void
}

const WEEK_DAYS = ['일', '월', '화', '수', '목', '금', '토']

export default function CalendarPicker({ value, minDate, rangeStart, rangeEnd, position, onSelect, onClose }: Props) {
  const [currentMonth, setCurrentMonth] = useState(() => {
    if (value) return parseISO(value)
    if (rangeStart) return parseISO(rangeStart)
    return new Date()
  })

  const monthStart = startOfMonth(currentMonth)
  const monthEnd = endOfMonth(currentMonth)
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd })
  const startDow = getDay(monthStart)

  function isInRange(d: Date) {
    if (!rangeStart || !rangeEnd) return false
    const s = parseISO(rangeStart), e = parseISO(rangeEnd)
    return !isBefore(d, s) && !isAfter(d, e)
  }

  function isDisabled(d: Date) {
    if (minDate && isBefore(d, parseISO(minDate))) return true
    return false
  }

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="fixed z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl p-3 w-64"
        style={{ left: Math.min(position.x, window.innerWidth - 270), top: position.y + 4 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-2">
          <button
            onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500"
          >
            <ChevronLeft size={14} />
          </button>
          <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
            {format(currentMonth, 'yyyy년 M월', { locale: ko })}
          </span>
          <button
            onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
            className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500"
          >
            <ChevronRight size={14} />
          </button>
        </div>

        <div className="grid grid-cols-7 mb-1">
          {WEEK_DAYS.map((d) => (
            <div key={d} className="text-center text-xs text-gray-400 py-0.5">{d}</div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-0.5">
          {Array.from({ length: startDow }).map((_, i) => <div key={`e${i}`} />)}
          {days.map((day) => {
            const dateStr = format(day, 'yyyy-MM-dd')
            const isSelected = value ? isSameDay(day, parseISO(value)) : false
            const inRange = isInRange(day)
            const disabled = isDisabled(day)
            const isRangeStart = rangeStart ? isSameDay(day, parseISO(rangeStart)) : false
            const isRangeEnd = rangeEnd ? isSameDay(day, parseISO(rangeEnd)) : false

            return (
              <button
                key={dateStr}
                disabled={disabled}
                onClick={() => { onSelect(dateStr); onClose() }}
                className={cn(
                  'w-full aspect-square flex items-center justify-center text-xs rounded transition-colors',
                  disabled
                    ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
                    : isSelected || isRangeStart || isRangeEnd
                      ? 'bg-violet-600 text-white font-semibold'
                      : inRange
                        ? 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300'
                        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                )}
              >
                {format(day, 'd')}
              </button>
            )
          })}
        </div>
      </div>
    </>
  )
}
