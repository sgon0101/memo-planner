'use client'

import { useEffect, useRef } from 'react'
import { format, addDays } from 'date-fns'
import { cn } from '@/lib/utils'
import type { Plan } from '@/types'

const HOUR_H = 60 // px per hour
const HOURS = Array.from({ length: 24 }, (_, i) => i)
const WEEKDAYS_SHORT = ['일', '월', '화', '수', '목', '금', '토']

interface WeekViewProps {
  weekStart: Date
  plans: Plan[]
  today: string
  selectedDate: string
  onSelectDate: (date: string) => void
  onNewPlan: (date: string, time?: string) => void
  onEditPlan: (plan: Plan) => void
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

function planTop(startTime: string): number {
  return (timeToMinutes(startTime) / 60) * HOUR_H
}

function planHeight(startTime: string, endTime: string): number {
  const diff = timeToMinutes(endTime) - timeToMinutes(startTime)
  return Math.max((diff / 60) * HOUR_H, 20)
}

export default function WeekView({
  weekStart, plans, today, selectedDate,
  onSelectDate, onNewPlan, onEditPlan,
}: WeekViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // 08:00으로 스크롤
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 8 * HOUR_H - 20
    }
  }, [])

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

  // 날짜별 시간 플랜 분류
  function getTimedPlans(dayStr: string): Plan[] {
    return plans.filter(
      (p) => (p.date === dayStr || (p.startDate && p.startDate <= dayStr && p.endDate && p.endDate >= dayStr))
        && !p.isAllDay && p.startTime && p.endTime
    )
  }

  // 종일 플랜
  function getAllDayPlans(dayStr: string): Plan[] {
    return plans.filter(
      (p) => (p.date === dayStr || (p.startDate && p.startDate <= dayStr && p.endDate && p.endDate >= dayStr))
        && (p.isAllDay || !p.startTime)
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* 날짜 헤더 */}
      <div className="flex border-b border-gray-200 dark:border-gray-800 flex-shrink-0">
        <div className="w-14 flex-shrink-0" />
        {days.map((day, i) => {
          const dayStr = format(day, 'yyyy-MM-dd')
          const isToday = dayStr === today
          return (
            <div
              key={i}
              className={cn(
                'flex-1 py-2 text-center border-l border-gray-100 dark:border-gray-800 cursor-pointer',
                isToday && 'bg-violet-50/50 dark:bg-violet-950/20'
              )}
              onClick={() => onSelectDate(dayStr === selectedDate ? '' : dayStr)}
            >
              <span className={cn('text-xs text-gray-400', i === 0 && 'text-red-400', i === 6 && 'text-blue-400')}>
                {WEEKDAYS_SHORT[i]}
              </span>
              <div className={cn(
                'mx-auto mt-0.5 w-7 h-7 flex items-center justify-center rounded-full text-sm font-medium',
                isToday ? 'bg-violet-600 text-white' : 'text-gray-700 dark:text-gray-300'
              )}>
                {format(day, 'd')}
              </div>
            </div>
          )
        })}
      </div>

      {/* 종일 영역 */}
      <div className="flex border-b border-gray-200 dark:border-gray-800 flex-shrink-0 min-h-8">
        <div className="w-14 flex-shrink-0 flex items-center justify-end pr-2">
          <span className="text-xs text-gray-400">종일</span>
        </div>
        {days.map((day, i) => {
          const dayStr = format(day, 'yyyy-MM-dd')
          const allDay = getAllDayPlans(dayStr)
          return (
            <div key={i} className="flex-1 border-l border-gray-100 dark:border-gray-800 py-0.5 px-0.5 space-y-0.5">
              {allDay.slice(0, 2).map((plan) => (
                <div
                  key={plan.id}
                  className="text-xs px-1 py-0.5 rounded truncate cursor-pointer"
                  style={{ backgroundColor: plan.color + '22', borderLeft: `2px solid ${plan.color}`, color: plan.color }}
                  onClick={(e) => { e.stopPropagation(); onEditPlan(plan) }}
                >
                  {plan.title}
                </div>
              ))}
              {allDay.length > 2 && <div className="text-xs text-gray-400 px-1">+{allDay.length - 2}</div>}
            </div>
          )
        })}
      </div>

      {/* 시간 그리드 */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="flex" style={{ height: `${24 * HOUR_H}px` }}>
          {/* 시간 레이블 */}
          <div className="w-14 flex-shrink-0 relative">
            {HOURS.map((h) => (
              <div
                key={h}
                className="absolute right-2 text-xs text-gray-400"
                style={{ top: `${h * HOUR_H - 8}px` }}
              >
                {h.toString().padStart(2, '0')}:00
              </div>
            ))}
          </div>

          {/* 날짜 컬럼 */}
          {days.map((day, i) => {
            const dayStr = format(day, 'yyyy-MM-dd')
            const isToday = dayStr === today
            const timedPlans = getTimedPlans(dayStr)

            return (
              <div
                key={i}
                className={cn(
                  'flex-1 border-l border-gray-100 dark:border-gray-800 relative',
                  isToday && 'bg-violet-50/30 dark:bg-violet-950/10'
                )}
                onClick={() => onNewPlan(dayStr)}
              >
                {/* 시간 줄 */}
                {HOURS.map((h) => (
                  <div
                    key={h}
                    className="absolute w-full border-t border-gray-100 dark:border-gray-800"
                    style={{ top: `${h * HOUR_H}px` }}
                  />
                ))}

                {/* 플랜 블록 */}
                {timedPlans.map((plan) => (
                  <div
                    key={plan.id}
                    className="absolute left-0.5 right-0.5 rounded px-1 py-0.5 text-xs overflow-hidden cursor-pointer hover:brightness-95"
                    style={{
                      top: `${planTop(plan.startTime!)}px`,
                      height: `${planHeight(plan.startTime!, plan.endTime!)}px`,
                      backgroundColor: plan.color + '33',
                      borderLeft: `3px solid ${plan.color}`,
                      color: plan.color,
                    }}
                    onClick={(e) => { e.stopPropagation(); onEditPlan(plan) }}
                  >
                    <div className="font-medium truncate">{plan.title}</div>
                    <div className="opacity-70">{plan.startTime?.slice(0, 5)}–{plan.endTime?.slice(0, 5)}</div>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
