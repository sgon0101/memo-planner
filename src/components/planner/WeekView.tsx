'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { format, addDays } from 'date-fns'
import { cn } from '@/lib/utils'
import { usePlanner } from '@/hooks/usePlanner'
import {
  HOUR_H, DRAG_THRESHOLD_PX, LONG_PRESS_MS,
  timeToMinutes, minutesToTime, snapMinutes, addDaysToISO, pxToMinutes,
} from '@/lib/planner/dragHelpers'
import type { Plan } from '@/types'

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

function planTop(startTime: string): number {
  return (timeToMinutes(startTime) / 60) * HOUR_H
}

function planHeight(startTime: string, endTime: string): number {
  const diff = timeToMinutes(endTime) - timeToMinutes(startTime)
  return Math.max((diff / 60) * HOUR_H, 20)
}

function isDraggable(p: Plan): boolean {
  return !p.isAllDay && !!p.startTime && !!p.endTime && !!p.date && !p.startDate && !p.isRecurringInstance
}

interface DragState {
  planId: string
  pointerId: number
  startClientX: number
  startClientY: number
  originalStartTime: string
  originalEndTime: string
  originalDate: string
  deltaY: number
  deltaDays: number
  moved: boolean
  colWidthPx: number
}

export default function WeekView({
  weekStart, plans, today, selectedDate,
  onSelectDate, onNewPlan, onEditPlan,
}: WeekViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const colsContainerRef = useRef<HTMLDivElement>(null)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // long-press 시작점 (timer 취소 판단용) + drag 종료 직후 click 차단용
  const longPressStart = useRef<{ x: number; y: number } | null>(null)
  const justDragged = useRef(false)
  const { editPlan } = usePlanner()

  const [drag, setDrag] = useState<DragState | null>(null)

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 8 * HOUR_H - 20
  }, [])

  // drag 중 페이지/그리드 스크롤 잠금 (모바일에서 위·아래 움직임이 스크롤로 새는 것 차단)
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

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

  function getTimedPlans(dayStr: string): Plan[] {
    return plans.filter(
      (p) => (p.date === dayStr || (p.startDate && p.startDate <= dayStr && p.endDate && p.endDate >= dayStr))
        && !p.isAllDay && p.startTime && p.endTime,
    )
  }
  function getAllDayPlans(dayStr: string): Plan[] {
    return plans.filter(
      (p) => (p.date === dayStr || (p.startDate && p.startDate <= dayStr && p.endDate && p.endDate >= dayStr))
        && (p.isAllDay || !p.startTime),
    )
  }

  function measureColWidth(): number {
    if (!colsContainerRef.current) return 100
    return (colsContainerRef.current.clientWidth - 56) / 7
  }

  // startDrag — explicit params (e 비동기 사용 회피)
  const startDrag = useCallback((
    plan: Plan,
    pointerId: number,
    clientX: number,
    clientY: number,
    target: HTMLElement,
  ) => {
    // setPointerCapture + touchAction을 즉시 DOM에 적용 (React 렌더 대기하지 않음)
    try { target.setPointerCapture(pointerId) } catch { /* ignore */ }
    target.style.touchAction = 'none'  // 그 즉시 페이지 스크롤 차단
    setDrag({
      planId: plan.id,
      pointerId,
      startClientX: clientX,
      startClientY: clientY,
      originalStartTime: plan.startTime!.slice(0, 5),
      originalEndTime: plan.endTime!.slice(0, 5),
      originalDate: plan.date!,
      deltaY: 0,
      deltaDays: 0,
      moved: false,
      colWidthPx: measureColWidth(),
    })
  }, [])

  function onPointerDown(e: React.PointerEvent, plan: Plan) {
    if (!isDraggable(plan)) return
    e.stopPropagation()
    const { pointerId, clientX, clientY, pointerType } = e
    const target = e.currentTarget as HTMLElement
    if (pointerType === 'touch') {
      // 모바일 — long-press 대기, 시작점 기억
      longPressStart.current = { x: clientX, y: clientY }
      longPressTimer.current = setTimeout(() => {
        startDrag(plan, pointerId, clientX, clientY, target)
        longPressStart.current = null
        navigator.vibrate?.(40)
      }, LONG_PRESS_MS)
    } else {
      // 데스크탑 — 즉시 drag 준비
      startDrag(plan, pointerId, clientX, clientY, target)
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    // long-press 대기 중 — 시작점에서 8px 이상 움직이면 취소 (스크롤 의도로 판단)
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
    const dx = e.clientX - drag.startClientX
    const moved = drag.moved || Math.abs(dy) > DRAG_THRESHOLD_PX || Math.abs(dx) > DRAG_THRESHOLD_PX
    const deltaDays = Math.round(dx / drag.colWidthPx)
    setDrag({ ...drag, deltaY: dy, deltaDays, moved })
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
    // touchAction 복원 — 다음 렌더에서 React style이 덮어쓰지만 사이 frame 안전망
    target.style.touchAction = ''

    const wasMoved = drag.moved
    const snapshot = drag

    if (!wasMoved) {
      // 단순 클릭 → 편집
      setDrag(null)
      onEditPlan(plan)
      return
    }

    // drop — 새 시간/날짜 계산
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
    const newDate = snapshot.deltaDays !== 0
      ? addDaysToISO(snapshot.originalDate, snapshot.deltaDays)
      : snapshot.originalDate

    const changed = newStartTime !== snapshot.originalStartTime
        || newEndTime !== snapshot.originalEndTime
        || newDate !== snapshot.originalDate

    if (changed) {
      try {
        // store가 업데이트된 후에 setDrag(null) — 깜빡임 방지
        // (editPlan은 supabase update + zustand updatePlan을 모두 호출)
        await editPlan(plan.id, { startTime: newStartTime, endTime: newEndTime, date: newDate })
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

  // 컬럼 클릭 시 새 플랜 — 단, drag 직후 일정 시간(400ms) 동안 차단
  function handleColumnClick(dayStr: string) {
    if (justDragged.current) return
    onNewPlan(dayStr)
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
                isToday && 'bg-violet-50/50 dark:bg-violet-950/20',
              )}
              onClick={() => onSelectDate(dayStr === selectedDate ? '' : dayStr)}
            >
              <span className={cn('text-xs text-gray-400', i === 0 && 'text-red-400', i === 6 && 'text-blue-400')}>
                {WEEKDAYS_SHORT[i]}
              </span>
              <div className={cn(
                'mx-auto mt-0.5 w-7 h-7 flex items-center justify-center rounded-full text-sm font-medium',
                isToday ? 'bg-violet-600 text-white' : 'text-gray-700 dark:text-gray-300',
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
        <div ref={colsContainerRef} className="flex" style={{ height: `${24 * HOUR_H}px` }}>
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
                  isToday && 'bg-violet-50/30 dark:bg-violet-950/10',
                )}
                onClick={() => handleColumnClick(dayStr)}
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
                {timedPlans.map((plan) => {
                  const draggable = isDraggable(plan)
                  // 시각 효과는 plan이 '원래 컬럼'에 그려질 때만 적용.
                  // store에서 plan.date가 새 날짜로 바뀌면 plan이 다른 컬럼으로 이동 → isInOriginalColumn=false → translateX/displayTop 적용 X
                  const isInOriginalColumn = drag?.originalDate === dayStr
                  const isThisDragging = drag?.planId === plan.id && drag.moved && isInOriginalColumn
                  const top = planTop(plan.startTime!)
                  const height = planHeight(plan.startTime!, plan.endTime!)
                  let displayTop = top
                  let translateX = 0
                  let snappedTime: string | null = null
                  if (isThisDragging && drag) {
                    const startMin = timeToMinutes(drag.originalStartTime)
                    const dur = timeToMinutes(drag.originalEndTime) - startMin
                    const minutesDelta = snapMinutes(pxToMinutes(drag.deltaY))
                    const newStart = Math.max(0, Math.min(1440 - dur, startMin + minutesDelta))
                    displayTop = (newStart / 60) * HOUR_H
                    translateX = drag.deltaDays * drag.colWidthPx
                    snappedTime = `${minutesToTime(newStart)} – ${minutesToTime(newStart + dur)}`
                  }
                  return (
                    <div
                      key={plan.id}
                      className={cn(
                        'absolute left-0.5 right-0.5 rounded px-1 py-0.5 text-xs overflow-hidden select-none',
                        draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
                        isThisDragging && 'opacity-90 ring-2 ring-violet-400 shadow-lg z-30',
                      )}
                      style={{
                        top: `${displayTop}px`,
                        height: `${height}px`,
                        backgroundColor: plan.color + '33',
                        borderLeft: `3px solid ${plan.color}`,
                        color: plan.color,
                        transform: isThisDragging ? `translateX(${translateX}px)` : undefined,
                        transition: isThisDragging ? 'none' : 'top 0.15s ease-out',
                        // drag 시작 후엔 페이지 스크롤 차단, 평소엔 세로 스크롤 허용
                        touchAction: drag?.planId === plan.id ? 'none' : 'pan-y',
                      }}
                      onPointerDown={(e) => onPointerDown(e, plan)}
                      onPointerMove={onPointerMove}
                      onPointerUp={(e) => onPointerUp(e, plan)}
                      onPointerCancel={onPointerCancel}
                      // 컬럼 onClick으로 전파되어 새 플랜 모달이 뜨는 것 차단
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
            )
          })}
        </div>
      </div>
    </div>
  )
}
