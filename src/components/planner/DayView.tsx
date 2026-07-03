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
  onNewPlan: (date: string, startTime?: string, endTime?: string) => void
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

type DragMode = 'move' | 'resize-top' | 'resize-bottom'

interface DragState {
  mode: DragMode
  planId: string
  pointerId: number
  startClientY: number
  originalStartTime: string
  originalEndTime: string
  deltaY: number
  moved: boolean
}

const MIN_DURATION_MIN = 15

export default function DayView({ date, plans, onNewPlan, onEditPlan }: DayViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressStart = useRef<{ x: number; y: number } | null>(null)
  const justDragged = useRef(false)
  const cleanupRef = useRef<(() => void) | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const plansRef = useRef<Plan[]>(plans)

  const [currentTop, setCurrentTop] = useState(nowTop())
  const { editPlan } = usePlanner()
  const [drag, setDrag] = useState<DragState | null>(null)
  useEffect(() => { dragRef.current = drag }, [drag])
  useEffect(() => { plansRef.current = plans }, [plans])

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

  // 언마운트 시 안전망
  useEffect(() => () => { cleanupRef.current?.() }, [])

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
    if (justDragged.current) return
    const rect = e.currentTarget.getBoundingClientRect()
    const y = e.clientY - rect.top
    const hours = Math.floor(y / HOUR_H)
    const minutes = Math.floor(((y % HOUR_H) / HOUR_H) * 60 / 15) * 15
    const time = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`
    let endHours = hours + 1
    let endMinutes = minutes
    if (endHours >= 24) { endHours = 23; endMinutes = 59 }
    const endTime = `${String(endHours).padStart(2, '0')}:${String(endMinutes).padStart(2, '0')}`
    onNewPlan(date, time, endTime)
  }

  // ── document level drag handlers ─────────────────────
  const onDocMove = useCallback((e: PointerEvent) => {
    const d = dragRef.current
    if (!d || d.pointerId !== e.pointerId) return
    const dy = e.clientY - d.startClientY
    const moved = d.moved || Math.abs(dy) > DRAG_THRESHOLD_PX
    const next = { ...d, deltaY: dy, moved }
    dragRef.current = next
    setDrag(next)
  }, [])

  const onDocUp = useCallback(async (e: PointerEvent) => {
    const d = dragRef.current
    if (!d || d.pointerId !== e.pointerId) return
    const plan = plansRef.current.find((p) => p.id === d.planId)

    cleanupRef.current?.()
    cleanupRef.current = null

    if (!plan) { setDrag(null); return }

    if (!d.moved) {
      setDrag(null)
      onEditPlan(plan)
      return
    }

    justDragged.current = true
    setTimeout(() => { justDragged.current = false }, 400)

    const startMin = timeToMinutes(d.originalStartTime)
    const endMin = timeToMinutes(d.originalEndTime)
    const dur = endMin - startMin
    const minutesDelta = snapMinutes(pxToMinutes(d.deltaY))

    let newStart = startMin
    let newEnd = endMin
    if (d.mode === 'move') {
      newStart = Math.max(0, Math.min(1440 - dur, startMin + minutesDelta))
      newEnd = newStart + dur
    } else if (d.mode === 'resize-top') {
      newStart = Math.max(0, Math.min(endMin - MIN_DURATION_MIN, startMin + minutesDelta))
    } else if (d.mode === 'resize-bottom') {
      newEnd = Math.min(1440, Math.max(startMin + MIN_DURATION_MIN, endMin + minutesDelta))
    }

    const newStartTime = minutesToTime(newStart)
    const newEndTime = minutesToTime(newEnd)

    if (newStartTime !== d.originalStartTime || newEndTime !== d.originalEndTime) {
      try {
        await editPlan(plan.id, { startTime: newStartTime, endTime: newEndTime })
      } catch (err) {
        console.error('drag editPlan 실패:', err)
      }
    }
    setDrag(null)
  }, [editPlan, onEditPlan])

  const startDrag = useCallback((
    plan: Plan,
    pointerId: number,
    clientY: number,
    target: HTMLElement,
    mode: DragMode = 'move',
  ) => {
    try { target.setPointerCapture(pointerId) } catch { /* ignore */ }
    target.style.touchAction = 'none'

    const oldBodyOverflow = document.body.style.overflow
    const scrollEl = scrollRef.current
    const oldScrollOverflow = scrollEl?.style.overflowY ?? ''
    document.body.style.overflow = 'hidden'
    if (scrollEl) scrollEl.style.overflowY = 'hidden'

    // touch-action은 제스처 시작 시점에 확정되므로 나중에 변경해도 무효.
    // non-passive touchmove에서 preventDefault()로 브라우저 스크롤을 강제 차단.
    const preventTouchScroll = (e: TouchEvent) => { e.preventDefault() }
    document.addEventListener('touchmove', preventTouchScroll, { passive: false })

    document.addEventListener('pointermove', onDocMove)
    document.addEventListener('pointerup', onDocUp)
    document.addEventListener('pointercancel', onDocUp)

    cleanupRef.current = () => {
      document.removeEventListener('touchmove', preventTouchScroll)
      document.removeEventListener('pointermove', onDocMove)
      document.removeEventListener('pointerup', onDocUp)
      document.removeEventListener('pointercancel', onDocUp)
      document.body.style.overflow = oldBodyOverflow
      if (scrollEl) scrollEl.style.overflowY = oldScrollOverflow
      try { target.style.touchAction = '' } catch { /* ignore */ }
      try { target.releasePointerCapture(pointerId) } catch { /* ignore */ }
    }

    const initial: DragState = {
      mode,
      planId: plan.id,
      pointerId,
      startClientY: clientY,
      originalStartTime: plan.startTime!.slice(0, 5),
      originalEndTime: plan.endTime!.slice(0, 5),
      deltaY: 0,
      moved: false,
    }
    dragRef.current = initial
    setDrag(initial)
  }, [onDocMove, onDocUp])

  function onPointerDown(e: React.PointerEvent, plan: Plan) {
    if (!isDraggable(plan)) return
    e.stopPropagation()
    const { pointerId, clientX, clientY, pointerType } = e
    const target = e.currentTarget as HTMLElement
    if (pointerType === 'touch') {
      e.preventDefault()
      longPressStart.current = { x: clientX, y: clientY }
      longPressTimer.current = setTimeout(() => {
        longPressTimer.current = null
        startDrag(plan, pointerId, clientY, target, 'move')
        longPressStart.current = null
        navigator.vibrate?.(40)
      }, LONG_PRESS_MS)
    } else {
      startDrag(plan, pointerId, clientY, target, 'move')
    }
  }

  // 리사이즈 핸들 — long-press 없이 즉시
  function onResizeDown(e: React.PointerEvent, plan: Plan, mode: 'resize-top' | 'resize-bottom') {
    if (!isDraggable(plan)) return
    e.stopPropagation()
    const handleEl = e.currentTarget as HTMLElement
    const blockEl = (handleEl.parentElement as HTMLElement) ?? handleEl
    if (e.pointerType === 'touch') e.preventDefault()
    startDrag(plan, e.pointerId, e.clientY, blockEl, mode)
  }

  function onPointerMoveBlock(e: React.PointerEvent) {
    if (longPressTimer.current && longPressStart.current && !drag) {
      const dx = e.clientX - longPressStart.current.x
      const dy = e.clientY - longPressStart.current.y
      if (Math.sqrt(dx * dx + dy * dy) > 8) {
        clearTimeout(longPressTimer.current)
        longPressTimer.current = null
        longPressStart.current = null
      }
    }
  }
  // 짧은 탭 (long-press 발화 전 손가락 뗌) → 상세 패널 열기
  function onPointerUpBlock(_e: React.PointerEvent, plan: Plan) {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
      longPressStart.current = null
      onEditPlan(plan)
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
            {HOURS.map((h) => (
              <div
                key={h}
                className="absolute w-full border-t border-gray-100 dark:border-gray-800"
                style={{ top: `${h * HOUR_H}px` }}
              />
            ))}

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

            {timedPlans.map((plan) => {
              const draggable = isDraggable(plan)
              const isThisDragging = drag?.planId === plan.id && drag.moved
              const top = planTop(plan.startTime!)
              const height = planHeight(plan.startTime!, plan.endTime!)
              let displayTop = top
              let displayHeight = height
              let snappedTime: string | null = null
              if (isThisDragging && drag) {
                const startMin = timeToMinutes(drag.originalStartTime)
                const endMin = timeToMinutes(drag.originalEndTime)
                const dur = endMin - startMin
                const minutesDelta = snapMinutes(pxToMinutes(drag.deltaY))
                if (drag.mode === 'move') {
                  const newStart = Math.max(0, Math.min(1440 - dur, startMin + minutesDelta))
                  displayTop = (newStart / 60) * HOUR_H
                  snappedTime = `${minutesToTime(newStart)} – ${minutesToTime(newStart + dur)}`
                } else if (drag.mode === 'resize-top') {
                  const newStart = Math.max(0, Math.min(endMin - MIN_DURATION_MIN, startMin + minutesDelta))
                  displayTop = (newStart / 60) * HOUR_H
                  displayHeight = ((endMin - newStart) / 60) * HOUR_H
                  snappedTime = `${minutesToTime(newStart)} – ${minutesToTime(endMin)}`
                } else if (drag.mode === 'resize-bottom') {
                  const newEnd = Math.min(1440, Math.max(startMin + MIN_DURATION_MIN, endMin + minutesDelta))
                  displayHeight = ((newEnd - startMin) / 60) * HOUR_H
                  snappedTime = `${minutesToTime(startMin)} – ${minutesToTime(newEnd)}`
                }
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
                    height: `${displayHeight}px`,
                    backgroundColor: plan.color + '33',
                    borderLeft: `3px solid ${plan.color}`,
                    color: plan.color,
                    transition: isThisDragging ? 'none' : 'top 0.15s ease-out, height 0.15s ease-out',
                    touchAction: drag?.planId === plan.id ? 'none' : 'pan-y',
                    WebkitTouchCallout: 'none',
                    WebkitUserSelect: 'none',
                  }}
                  onPointerDown={(e) => onPointerDown(e, plan)}
                  onPointerMove={onPointerMoveBlock}
                  onPointerUp={(e) => onPointerUpBlock(e, plan)}
                      onPointerCancel={() => {
                        if (longPressTimer.current) {
                          clearTimeout(longPressTimer.current)
                          longPressTimer.current = null
                          longPressStart.current = null
                        }
                      }}
                  onClick={(e) => e.stopPropagation()}
                  onContextMenu={(e) => e.preventDefault()}
                >
                  <div className="font-medium truncate">{plan.title}</div>
                  <div className="opacity-70">
                    {snappedTime ?? `${plan.startTime?.slice(0, 5)}–${plan.endTime?.slice(0, 5)}`}
                  </div>

                  {/* 리사이즈 핸들 (상/하) */}
                  {draggable && (
                    <>
                      <div
                        onPointerDown={(e) => onResizeDown(e, plan, 'resize-top')}
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          position: 'absolute', top: 0, left: 0, right: 0, height: 8,
                          cursor: 'ns-resize', touchAction: 'none',
                        }}
                        className="hover:bg-violet-400/30"
                      />
                      <div
                        onPointerDown={(e) => onResizeDown(e, plan, 'resize-bottom')}
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          position: 'absolute', bottom: 0, left: 0, right: 0, height: 8,
                          cursor: 'ns-resize', touchAction: 'none',
                        }}
                        className="hover:bg-violet-400/30"
                      />
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
