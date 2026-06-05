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

type DragMode = 'move' | 'resize-top' | 'resize-bottom'

interface DragState {
  mode: DragMode
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

const MIN_DURATION_MIN = 15  // 리사이즈 최소 길이

export default function WeekView({
  weekStart, plans, today, selectedDate,
  onSelectDate, onNewPlan, onEditPlan,
}: WeekViewProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const colsContainerRef = useRef<HTMLDivElement>(null)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressStart = useRef<{ x: number; y: number } | null>(null)
  const justDragged = useRef(false)
  // document listener 정리 + body/scroll overflow 복원을 한 번에 처리
  const cleanupRef = useRef<(() => void) | null>(null)
  // pointermove 핸들러가 항상 최신 drag state 접근 — ref로 우회 (closure stale 방지)
  const dragRef = useRef<DragState | null>(null)
  const plansRef = useRef<Plan[]>(plans)
  const { editPlan } = usePlanner()

  const [drag, setDrag] = useState<DragState | null>(null)
  useEffect(() => { dragRef.current = drag }, [drag])
  useEffect(() => { plansRef.current = plans }, [plans])

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 8 * HOUR_H - 20
  }, [])

  // 언마운트 시 안전망 — drag 중에 컴포넌트 사라지면 cleanup
  useEffect(() => () => { cleanupRef.current?.() }, [])

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))

  function getTimedPlans(dayStr: string): Plan[] {
    return plans.filter(
      (p) => (p.date === dayStr || (p.startDate && p.startDate <= dayStr && p.endDate && p.endDate >= dayStr))
        && !p.isAllDay && p.startTime && p.endTime,
    )
  }
  // 단일일 all-day (범위 제외) — 셀당 박스로 렌더
  function getSingleAllDayPlans(dayStr: string): Plan[] {
    return plans.filter(
      (p) => p.date === dayStr && !p.startDate && !p.endDate && (p.isAllDay || !p.startTime),
    )
  }

  // 주 범위 플랜 (startCol/endCol/slot) — spanning bar 오버레이로 1회만 렌더
  function getWeekRangePlans() {
    const dayStrs = days.map((d) => format(d, 'yyyy-MM-dd'))
    const weekStart = dayStrs[0]
    const weekEnd = dayStrs[6]
    const overlapping = plans
      .filter((p) => p.startDate && p.endDate)
      .filter((p) => p.startDate! <= weekEnd && p.endDate! >= weekStart)
    const slotEnds: string[] = []
    return overlapping.slice(0, 6).map((plan) => {
      const visStart = plan.startDate! < weekStart ? weekStart : plan.startDate!
      const visEnd = plan.endDate! > weekEnd ? weekEnd : plan.endDate!
      const startCol = dayStrs.indexOf(visStart)
      const endCol = dayStrs.indexOf(visEnd)
      let slot = slotEnds.findIndex((end) => end < visStart)
      if (slot === -1) slot = slotEnds.length
      slotEnds[slot] = visEnd
      return { plan, startCol, endCol, slot }
    })
  }

  function measureColWidth(): number {
    if (!colsContainerRef.current) return 100
    return (colsContainerRef.current.clientWidth - 56) / 7
  }

  // ── document level drag handlers ─────────────────────
  const onDocMove = useCallback((e: PointerEvent) => {
    const d = dragRef.current
    if (!d || d.pointerId !== e.pointerId) return
    const dy = e.clientY - d.startClientY
    const dx = e.clientX - d.startClientX
    const moved = d.moved || Math.abs(dy) > DRAG_THRESHOLD_PX || Math.abs(dx) > DRAG_THRESHOLD_PX
    const deltaDays = Math.round(dx / d.colWidthPx)
    const next = { ...d, deltaY: dy, deltaDays, moved }
    dragRef.current = next  // 다음 pointermove에서 누적 정확하도록 즉시 sync
    setDrag(next)
  }, [])

  const onDocUp = useCallback(async (e: PointerEvent) => {
    const d = dragRef.current
    if (!d || d.pointerId !== e.pointerId) return
    const plan = plansRef.current.find((p) => p.id === d.planId)

    // listener + overflow 복원 (한 번만)
    cleanupRef.current?.()
    cleanupRef.current = null

    if (!plan) { setDrag(null); return }

    if (!d.moved) {
      setDrag(null)
      onEditPlan(plan)
      return
    }

    // 새 시간/날짜 계산 — 모드별 분기
    justDragged.current = true
    setTimeout(() => { justDragged.current = false }, 400)

    const startMin = timeToMinutes(d.originalStartTime)
    const endMin = timeToMinutes(d.originalEndTime)
    const dur = endMin - startMin
    const minutesDelta = snapMinutes(pxToMinutes(d.deltaY))

    let newStart = startMin
    let newEnd = endMin
    let newDate = d.originalDate

    if (d.mode === 'move') {
      newStart = Math.max(0, Math.min(1440 - dur, startMin + minutesDelta))
      newEnd = newStart + dur
      newDate = d.deltaDays !== 0 ? addDaysToISO(d.originalDate, d.deltaDays) : d.originalDate
    } else if (d.mode === 'resize-top') {
      // startTime만 이동, endTime 고정. 최소 15분 보장.
      newStart = Math.max(0, Math.min(endMin - MIN_DURATION_MIN, startMin + minutesDelta))
    } else if (d.mode === 'resize-bottom') {
      // endTime만 이동, startTime 고정. 최소 15분 보장.
      newEnd = Math.min(1440, Math.max(startMin + MIN_DURATION_MIN, endMin + minutesDelta))
    }

    const newStartTime = minutesToTime(newStart)
    const newEndTime = minutesToTime(newEnd)

    const changed = newStartTime !== d.originalStartTime
        || newEndTime !== d.originalEndTime
        || newDate !== d.originalDate

    if (changed) {
      try {
        await editPlan(plan.id, { startTime: newStartTime, endTime: newEndTime, date: newDate })
      } catch (err) {
        console.error('drag editPlan 실패:', err)
      }
    }
    setDrag(null)
  }, [editPlan, onEditPlan])

  // startDrag — explicit params, 즉시 document listener 부착
  const startDrag = useCallback((
    plan: Plan,
    pointerId: number,
    clientX: number,
    clientY: number,
    target: HTMLElement,
    mode: DragMode = 'move',
  ) => {
    // setPointerCapture fallback (안 잡혀도 document listener가 잡음)
    try { target.setPointerCapture(pointerId) } catch { /* ignore */ }
    target.style.touchAction = 'none'

    // body + 시간 그리드 스크롤 잠금
    const oldBodyOverflow = document.body.style.overflow
    const scrollEl = scrollRef.current
    const oldScrollOverflow = scrollEl?.style.overflowY ?? ''
    document.body.style.overflow = 'hidden'
    if (scrollEl) scrollEl.style.overflowY = 'hidden'

    // touch-action은 제스처 시작 시점에 확정되므로 나중에 변경해도 무효.
    // non-passive touchmove에서 preventDefault()로 브라우저 스크롤을 강제 차단.
    const preventTouchScroll = (e: TouchEvent) => { e.preventDefault() }
    document.addEventListener('touchmove', preventTouchScroll, { passive: false })

    // document level pointermove/up 리스너 — setPointerCapture 안 잡혀도 모든 이벤트 잡음
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
      startClientX: clientX,
      startClientY: clientY,
      originalStartTime: plan.startTime!.slice(0, 5),
      originalEndTime: plan.endTime!.slice(0, 5),
      originalDate: plan.date!,
      deltaY: 0,
      deltaDays: 0,
      moved: false,
      colWidthPx: measureColWidth(),
    }
    // dragRef를 즉시 sync — 첫 pointermove가 도착해도 valid (useEffect 대기 X)
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
        startDrag(plan, pointerId, clientX, clientY, target, 'move')
        longPressStart.current = null
        navigator.vibrate?.(40)
      }, LONG_PRESS_MS)
    } else {
      startDrag(plan, pointerId, clientX, clientY, target, 'move')
    }
  }

  // 리사이즈 핸들 — long-press 없이 즉시 시작 (영역이 명확하니까)
  function onResizeDown(e: React.PointerEvent, plan: Plan, mode: 'resize-top' | 'resize-bottom') {
    if (!isDraggable(plan)) return
    e.stopPropagation()
    // 리사이즈 핸들은 블록 안의 자식이라 target을 블록(부모)으로 잡아야 setPointerCapture가 의미 있음
    const handleEl = e.currentTarget as HTMLElement
    const blockEl = (handleEl.parentElement as HTMLElement) ?? handleEl
    if (e.pointerType === 'touch') e.preventDefault()
    startDrag(plan, e.pointerId, e.clientX, e.clientY, blockEl, mode)
  }

  // long-press 대기 중에 손가락이 움직이면 timer 취소 (drag 시작 안 함)
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

  // long-press 대기 중 → 짧은 탭으로 판정해 상세 열기 (timer 만료 전 손가락 떼면)
  function onPointerUpBlock(_e: React.PointerEvent, plan: Plan) {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
      longPressStart.current = null
      // 짧은 탭 — drag로 인계되지 않았으므로 onEditPlan으로 상세 모달
      onEditPlan(plan)
    }
  }

  // 컬럼 클릭 시 새 플랜 — drag 직후 400ms 차단
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

      {/* 종일 영역 — 단일일 plans는 셀당, 범위 plans는 spanning overlay (Saturday 빈칸 버그 fix) */}
      {(() => {
        const rangePlans = getWeekRangePlans()
        const rangeSlotCount = rangePlans.reduce((m, r) => Math.max(m, r.slot + 1), 0)
        const rangeBarHeight = rangeSlotCount > 0 ? rangeSlotCount * 22 + 4 : 0
        return (
          <div className="flex border-b border-gray-200 dark:border-gray-800 flex-shrink-0 min-h-8">
            <div className="w-14 flex-shrink-0 flex items-start justify-end pr-2 pt-1.5" style={{ paddingTop: `${Math.max(6, rangeBarHeight + 4)}px` }}>
              <span className="text-xs text-gray-400">종일</span>
            </div>
            <div className="flex-1 grid grid-cols-7 relative">
              {days.map((day, i) => {
                const dayStr = format(day, 'yyyy-MM-dd')
                const single = getSingleAllDayPlans(dayStr)
                return (
                  <div
                    key={i}
                    className="border-l border-gray-100 dark:border-gray-800 px-0.5 pb-0.5 space-y-0.5"
                    style={{ paddingTop: `${rangeBarHeight + 2}px` }}
                  >
                    {single.slice(0, 2).map((plan) => (
                      <div
                        key={plan.id}
                        className="text-xs px-1 py-0.5 rounded truncate cursor-pointer"
                        style={{ backgroundColor: plan.color + '22', borderLeft: `2px solid ${plan.color}`, color: plan.color }}
                        onClick={(e) => { e.stopPropagation(); onEditPlan(plan) }}
                      >
                        {plan.title}
                      </div>
                    ))}
                    {single.length > 2 && <div className="text-xs text-gray-400 px-1">+{single.length - 2}</div>}
                  </div>
                )
              })}
              {/* 범위 플랜 spanning 오버레이 */}
              {rangePlans.map(({ plan, startCol, endCol, slot }) => {
                const span = endCol - startCol + 1
                return (
                  <div
                    key={`range-${plan.id}`}
                    onClick={(e) => { e.stopPropagation(); onEditPlan(plan) }}
                    title={plan.title}
                    className={cn(
                      'absolute h-5 text-xs flex items-center px-1.5 truncate cursor-pointer transition-opacity hover:opacity-80 z-10 rounded',
                      plan.isCompleted && 'opacity-50 line-through',
                    )}
                    style={{
                      top: `${2 + slot * 22}px`,
                      left: `calc(${startCol} / 7 * 100% + 1px)`,
                      width: `calc(${span} / 7 * 100% - 2px)`,
                      backgroundColor: plan.color + '28',
                      borderLeft: `3px solid ${plan.color}`,
                      color: plan.color,
                    }}
                  >
                    {plan.title}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })()}

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
                {HOURS.map((h) => (
                  <div
                    key={h}
                    className="absolute w-full border-t border-gray-100 dark:border-gray-800"
                    style={{ top: `${h * HOUR_H}px` }}
                  />
                ))}

                {timedPlans.map((plan) => {
                  const draggable = isDraggable(plan)
                  const isInOriginalColumn = drag?.originalDate === dayStr
                  const isThisDragging = drag?.planId === plan.id && drag.moved && isInOriginalColumn
                  const top = planTop(plan.startTime!)
                  const height = planHeight(plan.startTime!, plan.endTime!)
                  let displayTop = top
                  let displayHeight = height
                  let translateX = 0
                  let snappedTime: string | null = null
                  if (isThisDragging && drag) {
                    const startMin = timeToMinutes(drag.originalStartTime)
                    const endMin = timeToMinutes(drag.originalEndTime)
                    const dur = endMin - startMin
                    const minutesDelta = snapMinutes(pxToMinutes(drag.deltaY))
                    if (drag.mode === 'move') {
                      const newStart = Math.max(0, Math.min(1440 - dur, startMin + minutesDelta))
                      displayTop = (newStart / 60) * HOUR_H
                      translateX = drag.deltaDays * drag.colWidthPx
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
                        'absolute left-0.5 right-0.5 rounded px-1 py-0.5 text-xs overflow-hidden select-none',
                        draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
                        isThisDragging && 'opacity-90 ring-2 ring-violet-400 shadow-lg z-30',
                      )}
                      style={{
                        top: `${displayTop}px`,
                        height: `${displayHeight}px`,
                        backgroundColor: plan.color + '33',
                        borderLeft: `3px solid ${plan.color}`,
                        color: plan.color,
                        transform: isThisDragging ? `translateX(${translateX}px)` : undefined,
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

                      {/* 리사이즈 핸들 (상/하) — draggable한 단일일 비반복 블록만 */}
                      {draggable && (
                        <>
                          <div
                            onPointerDown={(e) => onResizeDown(e, plan, 'resize-top')}
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              position: 'absolute', top: 0, left: 0, right: 0, height: 8,
                              cursor: 'ns-resize', touchAction: 'none',
                              // 호버 시 살짝 보이는 막대 (안 보이지만 클릭 영역 확보)
                            }}
                            className="group hover:bg-violet-400/30"
                          />
                          <div
                            onPointerDown={(e) => onResizeDown(e, plan, 'resize-bottom')}
                            onClick={(e) => e.stopPropagation()}
                            style={{
                              position: 'absolute', bottom: 0, left: 0, right: 0, height: 8,
                              cursor: 'ns-resize', touchAction: 'none',
                            }}
                            className="group hover:bg-violet-400/30"
                          />
                        </>
                      )}
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
