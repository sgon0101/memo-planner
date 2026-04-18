'use client'

import { useEffect, useRef, useState } from 'react'
import type { Plan } from '@/types'

const HOUR_H = 60
const HOURS = Array.from({ length: 24 }, (_, i) => i)

interface DayViewProps {
  date: string
  plans: Plan[]
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

function nowTop(): number {
  const now = new Date()
  return ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR_H
}

export default function DayView({ date, plans, onNewPlan, onEditPlan }: DayViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [currentTop, setCurrentTop] = useState(nowTop())

  useEffect(() => {
    if (scrollRef.current) {
      const top = nowTop()
      scrollRef.current.scrollTop = Math.max(0, top - 100)
    }
  }, [])

  useEffect(() => {
    const interval = setInterval(() => setCurrentTop(nowTop()), 60000)
    return () => clearInterval(interval)
  }, [])

  const today = new Date().toISOString().slice(0, 10)
  const isToday = date === today

  const timedPlans = plans.filter(
    (p) => (p.date === date || (p.startDate && p.startDate <= date && p.endDate && p.endDate >= date))
      && !p.isAllDay && p.startTime && p.endTime
  )
  const allDayPlans = plans.filter(
    (p) => (p.date === date || (p.startDate && p.startDate <= date && p.endDate && p.endDate >= date))
      && (p.isAllDay || !p.startTime)
  )

  function handleGridClick(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const y = e.clientY - rect.top
    const hours = Math.floor(y / HOUR_H)
    const minutes = Math.floor(((y % HOUR_H) / HOUR_H) * 60 / 15) * 15
    const time = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`
    onNewPlan(date, time)
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* 종일 영역 */}
      {allDayPlans.length > 0 && (
        <div className="flex border-b border-gray-200 dark:border-gray-800 flex-shrink-0 py-1 px-1 gap-1 flex-wrap">
          <span className="text-xs text-gray-400 self-center mr-1 w-14 text-right pr-2">종일</span>
          {allDayPlans.map((plan) => (
            <div
              key={plan.id}
              className="text-xs px-2 py-0.5 rounded cursor-pointer"
              style={{ backgroundColor: plan.color + '22', borderLeft: `2px solid ${plan.color}`, color: plan.color }}
              onClick={() => onEditPlan(plan)}
            >
              {plan.title}
            </div>
          ))}
        </div>
      )}

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

          {/* 하루 컬럼 */}
          <div
            className="flex-1 border-l border-gray-100 dark:border-gray-800 relative cursor-pointer"
            onClick={handleGridClick}
          >
            {/* 시간 줄 */}
            {HOURS.map((h) => (
              <div
                key={h}
                className="absolute w-full border-t border-gray-100 dark:border-gray-800"
                style={{ top: `${h * HOUR_H}px` }}
              />
            ))}

            {/* 현재 시각 표시선 */}
            {isToday && (
              <div
                className="absolute left-0 right-0 z-10 pointer-events-none"
                style={{ top: `${currentTop}px` }}
              >
                <div className="flex items-center">
                  <div className="w-2 h-2 rounded-full bg-red-500 -ml-1 flex-shrink-0" />
                  <div className="flex-1 border-t-2 border-red-500" />
                </div>
              </div>
            )}

            {/* 플랜 블록 */}
            {timedPlans.map((plan) => (
              <div
                key={plan.id}
                className="absolute left-1 right-1 rounded px-2 py-1 text-xs overflow-hidden cursor-pointer hover:brightness-95"
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
        </div>
      </div>
    </div>
  )
}
