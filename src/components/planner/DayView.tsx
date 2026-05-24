'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { usePlanner } from '@/hooks/usePlanner'
import {
  HOUR_H, DRAG_THRESHOLD_PX, LONG_PRESS_MS,
  timeToMinutes, minutesToTime, snapMinutes, pxToMinutes,
} from '@/lib/planner/dragHelpers'
import { cn } from '@/lib/utils'
import type { Plan } from '@/types'

const HOURS = Array.from({ length: 24 }, (_, i) => i)

interface DayViewProps {
  date: string
  plans: Plan[]
  onNewPlan: (date: string, time?: string) => void
  onEditPlan: (plan: Plan) => void
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
function isDraggable(p: Plan): boolean {
  return !p.isAllDay && !!p.startTime && !!p.endTime && !!p.date && !p.startDate && !p.isRecurringInstance
}

interface DragState {
  planId: string
  pointerId: number
  startClientY: number
  originalStartTime: string
  originalEndTime: string
  deltaY: number
  moved: boolean
}

export default function DayView({ date, plans, onNewPlan, onEditPlan }: DayViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressStart = useRef<{ x: number; y: number } | null>(null)
  const justDragged = useRef(false)
  const [currentTop, setCurrentTop] = useState(nowTop())
  const { editPlan } = usePlanner()
  const [drag, setDrag] = useState<DragState | null>(null)

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

  // drag 중 페이지/그리드 스크롤 잠금 (모바일 세로 스크롤 누수 차단)
  useEffect(() => {
    if (!drag) return
    const scrollEl = scrollRef.current
    const oldBodyOverflow = document.body.style.overflow
    const oldScrollOverflow = scrollEl?.style.overflowY ?? ''
    document.body.style.overflow = 'hidden'
    if (scrollEl) scrollEl.style.overflowY = 'hidden'
    return () => {
      document.body.style.overflow = oldBodyOverflow
      if (scrollEl) scrollEl.style.overflowY = oldScrollOverflow
    }
  }, [drag])

  const today = new Date().toISOString().slice(0, 10)
  const isToday = date === today

  const timedPlans = plans.filter(
    (p) => (p.date === date || (p.startDate && p.startDate <= date && p.endDate && p.endDate >= date))
      && !p.isAllDay && p.startTime && p.endTime,
  )
  const allDayPlans = plans.filter(
    (p) => (p.date === date || (p.startDate && p.startDate <= date && p.endDate && p.endDate >= date))
      && (p.isAllDay || !p.startTime),
  )

  function handleGridClick(e: React.MouseEvent<HTMLDivElement>) {
    // drag 직후 click 차단
    if (justDragged.current) return
    const rect = e.currentTarget.getBoundingClientRect()
    const y = e.clientY - rect.top
    const hours = Math.floor(y / HOUR_H)
    const minutes = Math.floor(((y % HOUR_H) / HOUR_H) * 60 / 15) * 15
    const time = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`
    onNewPlan(date, time)
  }

  // ── 드래그 핸들러 ──────────────────────────────────────
  const startDrag = useCallback((
    plan: Plan,
    pointerId: number,
    clientY: number,
    target: HTMLElement,
  ) => {
    try { target.setPointerCapture(pointerId) } catch { /* ignore */ }
    target.style.touchAction = 'none'  // 즉시 페이지 스크롤 차단
    setDrag({
      planId: plan.id,
      pointerId,
      startClientY: clientY,
      originalStartTime: plan.startTime!.slice(0, 5),
      originalEndTime: plan.endTime!.slice(0, 5),
      deltaY: 0,
      moved: false,
    })
  }, [])

  function onPointerDown(e: React.PointerEvent, plan: Plan) {
    if (!isDraggable(plan)) return
    e.stopPropagation()
    const { pointerId, clientX, clientY, pointerType } = e
    const target = e.currentTarget as HTMLElement
    if (pointerType === 'touch') {
      longPressStart.current = { x: clientX, y: clientY }
      longPressTimer.current = setTimeout(() => {
        startDrag(plan, pointerId, clientY, target)
        longPressStart.current = null
        navigator.vibrate?.(40)
      }, LONG_PRESS_MS)
    } else {
      startDrag(plan, pointerId, clientY, target)
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    if (longPressTimer.current && longPressStart.current && !drag) {
      const dx = e.clientX - longPressStart.current.x
      const dy = e.clientY - longPressStart.current.y
      if (Math.sqrt(dx * dx + dy * dy) > 8) {
        clearTimeout(longPressTimer.current)
        longPressTimer.current = null
        longPressStart.current = null
      }
    }
    if (!drag || drag.pointerId !== e.pointerId) return
    const dy = e.clientY - drag.startClientY
    const moved = drag.moved || Math.abs(dy) > DRAG_THRESHOLD_PX
    setDrag({ ...drag, deltaY: dy, moved })
  }

  async function onPointerUp(e: React.PointerEvent, plan: Plan) {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
      longPressStart.current = null
    }
    if (!drag || drag.pointerId !== e.pointerId) return
    const target = e.currentTarget as HTMLElement
    try { target.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
    target.style.touchAction = ''

    const wasMoved = drag.moved
    const snapshot = drag

    if (!wasMoved) {
      setDrag(null)
      onEditPlan(plan)
      return
    }

    justDragged.current = true
    setTimeout(() => { justDragged.current = false }, 400)

    const startMin = timeToMinutes(snapshot.originalStartTime)
    const endMin = timeToMinutes(snapshot.originalEndTime)
    const dur = endMin - startMin
    const minutesDelta = snapMinutes(pxToMinutes(snapshot.deltaY))
    let newStart = startMin + minutesDelta
    newStart = Math.max(0, Math.min(1440 - dur, newStart))
    const newEnd = newStart + dur
    const newStartTime = minutesToTime(newStart)
    const newEndTime = minutesToTime(newEnd)

    const changed = newStartTime !== snapshot.originalStartTime || newEndTime !== snapshot.originalEndTime
    if (changed) {
      try {
        await editPlan(plan.id, { startTime: newStartTime, endTime: newEndTime })
      } catch (err) {
        console.error('drag editPlan 실패:', err)
      }
    }
    setDrag(null)
  }

  function onPointerCancel(e: React.PointerEvent) {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
      longPressStart.current = null
    }
    if (drag && drag.pointerId === e.pointerId) {
      const target = e.currentTarget as HTMLElement
      target.style.touchAction = ''
      setDrag(null)
    }
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
            {timedPlans.map((plan) => {
              const draggable = isDraggable(plan)
              const isThisDragging = drag?.planId === plan.id && drag.moved
              const top = planTop(plan.startTime!)
              const height = planHeight(plan.startTime!, plan.endTime!)
              let displayTop = top
              let snappedTime: string | null = null
              if (isThisDragging && drag) {
                const startMin = timeToMinutes(drag.originalStartTime)
                const dur = timeToMinutes(drag.originalEndTime) - startMin
                const minutesDelta = snapMinutes(pxToMinutes(drag.deltaY))
                const newStart = Math.max(0, Math.min(1440 - dur, startMin + minutesDelta))
                displayTop = (newStart / 60) * HOUR_H
                snappedTime = `${minutesToTime(newStart)} – ${minutesToTime(newStart + dur)}`
              }
              return (
                <div
                  key={plan.id}
                  className={cn(
                    'absolute left-1 right-1 rounded px-2 py-1 text-xs overflow-hidden select-none',
                    draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
                    isThisDragging && 'opacity-90 ring-2 ring-violet-400 shadow-lg z-30',
                  )}
                  style={{
                    top: `${displayTop}px`,
                    height: `${height}px`,
                    backgroundColor: plan.color + '33',
                    borderLeft: `3px solid ${plan.color}`,
                    color: plan.color,
                    transition: isThisDragging ? 'none' : 'top 0.15s ease-out',
                    touchAction: drag?.planId === plan.id ? 'none' : 'pan-y',
                  }}
                  onPointerDown={(e) => onPointerDown(e, plan)}
                  onPointerMove={onPointerMove}
                  onPointerUp={(e) => onPointerUp(e, plan)}
                  onPointerCancel={onPointerCancel}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="font-medium truncate">{plan.title}</div>
                  <div className="opacity-70">
                    {snappedTime ?? `${plan.startTime?.slice(0, 5)}–${plan.endTime?.slice(0, 5)}`}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
