'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  format, startOfMonth, endOfMonth,
  startOfWeek, endOfWeek, eachDayOfInterval,
  isSameMonth, addMonths, subMonths, addWeeks, subWeeks, addDays, subDays, parseISO,
} from 'date-fns'
import { ko } from 'date-fns/locale'
import { ChevronLeft, ChevronRight, ChevronDown, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { usePlannerStore } from '@/store/plannerStore'
import { usePlanner } from '@/hooks/usePlanner'
import { useSwipeGesture } from '@/hooks/useSwipeGesture'
import { expandRecurringPlans } from '@/lib/planner/expandRecurringPlans'
import RangeBar from './RangeBar'
import PlanPanel from './PlanPanel'
import PlanFormModal from './PlanFormModal'
import WeekView from './WeekView'
import DayView from './DayView'
import type { Plan } from '@/types'

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']
const MAX_RANGE_BARS = 3

export default function CalendarView() {
  const {
    plans, selectedDate, selectDate,
    currentMonth, setCurrentMonth,
    currentWeek, setCurrentWeek,
    viewMode, setViewMode,
    recurringCompletions,
    setExpandedPlans,
  } = usePlannerStore()

  const { load } = usePlanner()

  // 반복 플랜 전개
  const expandedPlans = useMemo(() => {
    const monthStart = startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 0 })
    const monthEnd = endOfWeek(endOfMonth(currentMonth), { weekStartsOn: 0 })
    const weekEnd = addDays(currentWeek, 6)
    const dayDate = selectedDate ? parseISO(selectedDate) : new Date()

    const candidates = [monthStart, currentWeek, dayDate]
    const viewStart = candidates.reduce((a, b) => a < b ? a : b)
    const viewEnd = [monthEnd, weekEnd, dayDate].reduce((a, b) => a > b ? a : b)

    return expandRecurringPlans(plans, viewStart, viewEnd, recurringCompletions)
  }, [plans, recurringCompletions, currentMonth, currentWeek, selectedDate])

  // store 동기화 — PlanPanel이 store에서 expandedPlans를 읽으므로 항상 최신값 유지
  useEffect(() => { setExpandedPlans(expandedPlans) }, [expandedPlans])

  // ?date=&focus= URL 파라미터 → 해당 날짜로 이동 + PlanDetailPanel 자동 오픈
  // 홈 화면 "이번 주 플랜" 카드에서 진입할 때 사용
  const searchParams = useSearchParams()
  const focusedAppliedRef = useRef(false)
  useEffect(() => {
    if (focusedAppliedRef.current) return
    const date = searchParams.get('date')
    const focus = searchParams.get('focus')
    if (!date && !focus) return
    if (expandedPlans.length === 0) return  // 플랜 로드 후 처리
    focusedAppliedRef.current = true
    if (date) {
      selectDate(date)
      setViewMode('day')
    }
    // focus가 있으면 그 plan의 상세를 자동 오픈하기 위해 sessionStorage에 저장
    // (PlanPanel이 이를 읽어 PlanDetailPanel 오픈)
    if (focus && typeof window !== 'undefined') {
      sessionStorage.setItem('planner-focus-plan', focus)
      // 트리거 이벤트로 PlanPanel이 즉시 반응하도록
      window.dispatchEvent(new CustomEvent('planner:focus-plan', { detail: { id: focus } }))
    }
  }, [expandedPlans, searchParams, selectDate, setViewMode])

  const [formState, setFormState] = useState<{ open: boolean; date: string; plan?: Plan; initialTime?: string }>({
    open: false, date: '',
  })
  const [syncing, setSyncing] = useState(false)

  async function handleSync() {
    setSyncing(true)
    try {
      const res = await fetch('/api/calendar/sync', { method: 'POST' })
      const json = await res.json()
      if (!res.ok) {
        if (json.error === 'Google Calendar not connected') {
          window.location.href = '/api/calendar/auth'
        }
        return
      }
      await load()
      alert(`Google Calendar 동기화 완료 (${json.synced}개 추가)`)
    } catch {
      alert('동기화 중 오류가 발생했습니다.')
    } finally {
      setSyncing(false)
    }
  }

  const today = format(new Date(), 'yyyy-MM-dd')
  const isViewingToday = selectedDate === today

  function goToToday() {
    const now = new Date()
    setCurrentMonth(now)
    setCurrentWeek(startOfWeek(now, { weekStartsOn: 0 }))
    selectDate(today)
  }

  // 이전/다음 — 헤더 버튼 + 모바일 스와이프 공용
  function goPrev() {
    if (viewMode === 'month') setCurrentMonth(subMonths(currentMonth, 1))
    else if (viewMode === 'week') setCurrentWeek(subWeeks(currentWeek, 1))
    else selectDate(format(subDays(parseISO(selectedDate || today), 1), 'yyyy-MM-dd'))
  }
  function goNext() {
    if (viewMode === 'month') setCurrentMonth(addMonths(currentMonth, 1))
    else if (viewMode === 'week') setCurrentWeek(addWeeks(currentWeek, 1))
    else selectDate(format(addDays(parseISO(selectedDate || today), 1), 'yyyy-MM-dd'))
  }

  // 모바일 좌우 스와이프 (월/주/일 네비게이션) — useSwipeGesture 통합 파이프라인
  // 가로 60px 이상 + 세로보다 1.5배 우세 + 500ms 이내. touch 전용 (데스크탑 마우스 드래그 제외)
  const {
    ref: swipeRef,
    onClickCapture: onSwipeClickCapture,
  } = useSwipeGesture<HTMLDivElement>({
    axis: 'x',
    threshold: 60,
    dominance: 1.5,
    maxDuration: 500,
    pointerTypes: ['touch'],
    suppressClickAfterSwipe: true, // 스와이프 직후의 click 한 번 차단 (셀 selectDate 방지)
    onSwipeLeft: goNext,
    onSwipeRight: goPrev,
  })

  // 모바일 기본 뷰는 주 — 새로고침마다 적용 (viewMode는 persist되지 않으므로 매 mount마다 검사)
  // 사용자가 세션 중에 월로 바꿔도 새로고침하면 다시 주로 (사용자 명시 요구)
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (window.innerWidth < 768 && viewMode === 'month') {
      setViewMode('week')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])


  // 달력에 표시할 날짜 배열 (6주 × 7일)
  const { weeks } = useMemo(() => {
    const monthStart = startOfMonth(currentMonth)
    const monthEnd = endOfMonth(currentMonth)
    const calStart = startOfWeek(monthStart, { weekStartsOn: 0 })
    const calEnd = endOfWeek(monthEnd, { weekStartsOn: 0 })
    const days = eachDayOfInterval({ start: calStart, end: calEnd })
    const weeks: Date[][] = []
    for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7))
    return { weeks }
  }, [currentMonth])

  // 특정 날짜의 단일일 플랜 (반복 전개 포함)
  function getDayPlans(dayStr: string): Plan[] {
    return expandedPlans.filter((p) => p.date === dayStr)
  }

  // 특정 주에 걸리는 범위 플랜 (startCol, endCol, slot 포함)
  function getWeekRangePlans(week: Date[]) {
    const weekStrs = week.map((d) => format(d, 'yyyy-MM-dd'))
    const weekStart = weekStrs[0]
    const weekEnd = weekStrs[6]

    const overlapping = expandedPlans
      .filter((p) => p.startDate && p.endDate)
      .filter((p) => p.startDate! <= weekEnd && p.endDate! >= weekStart)

    // 슬롯 할당 (greedy)
    const slotEnds: string[] = [] // slotEnds[i] = 해당 슬롯의 마지막 날짜
    return overlapping.slice(0, MAX_RANGE_BARS).map((plan) => {
      const visStart = plan.startDate! < weekStart ? weekStart : plan.startDate!
      const visEnd = plan.endDate! > weekEnd ? weekEnd : plan.endDate!
      const startCol = weekStrs.indexOf(visStart)
      const endCol = weekStrs.indexOf(visEnd)

      // 빈 슬롯 찾기
      let slot = slotEnds.findIndex((end) => end < visStart)
      if (slot === -1) { slot = slotEnds.length }
      slotEnds[slot] = visEnd

      return { plan, startCol, endCol, slot }
    })
  }

  // panelDismissed — 일 뷰에서 panel만 숨기고 selectedDate는 유지하기 위한 별도 상태
  // selectedDate가 바뀌면(네비게이션) 자동 reset → 새 날짜에서 panel 다시 열림
  const [panelDismissed, setPanelDismissed] = useState(false)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 날짜 변경 시 panel 닫힘 상태 리셋 (의도된 패턴)
    setPanelDismissed(false)
  }, [selectedDate])

  function handlePanelClose() {
    if (viewMode === 'day') {
      // 일 뷰: panel만 숨김 — selectedDate 유지 → DayView가 today로 안 돌아감
      setPanelDismissed(true)
    } else {
      // 월/주 뷰: 기존대로 날짜 선택 해제
      selectDate('')
    }
  }

  const panelOpen = !!selectedDate && !panelDismissed

  return (
    <div className="flex h-full overflow-hidden">
      {/* 캘린더 메인 */}
      <div className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-gray-900">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-3 sm:px-5 py-3 border-b border-gray-200 dark:border-gray-800 flex-shrink-0">
          <div className="flex items-center gap-0.5 sm:gap-2">
            <button
              onClick={goPrev}
              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400 transition-colors"
            >
              <ChevronLeft size={16} />
            </button>

            {/* 데스크톱: 기존 전체 날짜 표시 */}
            <h2 className="hidden sm:block text-base font-semibold text-gray-900 dark:text-white w-40 text-center">
              {viewMode === 'month' && format(currentMonth, 'yyyy년 M월', { locale: ko })}
              {viewMode === 'week' && (() => {
                const ws = currentWeek
                const we = addDays(ws, 6)
                return format(ws, 'M월 d일', { locale: ko }) + ' – ' + format(we, 'd일', { locale: ko })
              })()}
              {viewMode === 'day' && format(parseISO(selectedDate || today), 'yyyy년 M월 d일 (eee)', { locale: ko })}
            </h2>

            {/* 모바일: 짧게 */}
            <h2 className="sm:hidden text-sm font-semibold text-gray-900 dark:text-white w-20 text-center">
              {viewMode === 'month' && format(currentMonth, 'M월', { locale: ko })}
              {viewMode === 'week' && (() => {
                const ws = currentWeek
                const we = addDays(ws, 6)
                return format(ws, 'M/d') + '–' + format(we, 'M/d')
              })()}
              {viewMode === 'day' && format(parseISO(selectedDate || today), 'M/d (eee)', { locale: ko })}
            </h2>

            <button
              onClick={goNext}
              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400 transition-colors"
            >
              <ChevronRight size={16} />
            </button>
            <button
              onClick={goToToday}
              disabled={isViewingToday}
              className={cn(
                'text-xs px-2 sm:px-2.5 py-1 rounded-lg border transition-colors disabled:cursor-default whitespace-nowrap',
                isViewingToday
                  ? 'border-gray-200 dark:border-gray-700 text-gray-300 dark:text-gray-600'
                  : 'border-violet-500 text-violet-600 hover:bg-violet-50 dark:hover:bg-violet-950/30'
              )}
            >
              오늘
            </button>
          </div>

          <div className="flex items-center gap-1 sm:gap-2">
            {/* Google Calendar 동기화 */}
            <button
              onClick={handleSync}
              disabled={syncing}
              title="Google Calendar 동기화"
              className="flex items-center gap-1.5 text-xs px-2 sm:px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
            >
              <RefreshCw size={13} className={cn('flex-shrink-0', syncing && 'animate-spin')} />
              <span className="hidden sm:inline">Google 동기화</span>
              <span className="sm:hidden flex flex-col items-start leading-tight text-[10px]">
                <span>Google</span>
                <span>동기화</span>
              </span>
            </button>

            {/* 데스크톱: 평탄 뷰 토글 */}
            <div className="hidden sm:flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
              {(['month', 'week', 'day'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={cn(
                    'px-3 py-1.5 text-xs font-medium transition-colors',
                    viewMode === mode
                      ? 'bg-violet-600 text-white'
                      : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                  )}
                >
                  {{ month: '월', week: '주', day: '일' }[mode]}
                </button>
              ))}
            </div>

            {/* 모바일: 드롭다운 */}
            <div className="sm:hidden">
              <ViewModeDropdown viewMode={viewMode} onChange={setViewMode} />
            </div>
          </div>
        </div>

        {/* 요일 헤더 */}
        <div className="grid grid-cols-7 border-b border-gray-200 dark:border-gray-800 flex-shrink-0">
          {WEEKDAYS.map((day, i) => (
            <div
              key={day}
              className={cn(
                'py-2 text-center text-xs font-medium',
                i === 0 ? 'text-red-400' : i === 6 ? 'text-blue-400' : 'text-gray-500 dark:text-gray-400'
              )}
            >
              {day}
            </div>
          ))}
        </div>

        {/* 달력 그리드 (모바일 스와이프 핸들러 부착) */}
        <div
          ref={swipeRef}
          className="flex-1 overflow-auto"
          onClickCapture={onSwipeClickCapture}
        >
          {viewMode === 'month' && weeks.map((week, wi) => {
            const rangePlans = getWeekRangePlans(week)
            const rangeSlotCount = rangePlans.reduce((m, r) => Math.max(m, r.slot + 1), 0)
            const barAreaHeight = rangeSlotCount > 0 ? rangeSlotCount * 22 + 4 : 0

            return (
              <div key={wi} className="border-b border-gray-100 dark:border-gray-800">
                <div className="relative grid grid-cols-7">
                  {/* 날짜 셀 */}
                  {week.map((day, di) => {
                    const dayStr = format(day, 'yyyy-MM-dd')
                    const isToday = dayStr === today
                    const isSelected = dayStr === selectedDate
                    const inMonth = isSameMonth(day, currentMonth)
                    const dayPlans = getDayPlans(dayStr)

                    return (
                      <div
                        key={di}
                        className={cn(
                          'border-r border-gray-100 dark:border-gray-800 cursor-pointer transition-colors',
                          !inMonth && 'bg-gray-50/60 dark:bg-gray-900/60',
                          isSelected && 'bg-violet-50/60 dark:bg-violet-950/20',
                          !isSelected && inMonth && 'hover:bg-gray-50 dark:hover:bg-gray-800/40',
                          di === 6 && 'border-r-0'
                        )}
                        style={{ paddingTop: `${barAreaHeight}px` }}
                        onClick={() => selectDate(isSelected ? '' : dayStr)}
                      >
                        {/* 날짜 숫자 */}
                        <div className="px-1.5 pt-1.5 pb-1">
                          <span
                            className={cn(
                              'inline-flex items-center justify-center w-6 h-6 text-xs font-medium rounded-full',
                              isToday && 'bg-violet-600 text-white',
                              !isToday && di === 0 && inMonth && 'text-red-400',
                              !isToday && di === 6 && inMonth && 'text-blue-400',
                              !isToday && !inMonth && 'text-gray-300 dark:text-gray-700',
                              !isToday && inMonth && di > 0 && di < 6 && 'text-gray-700 dark:text-gray-300'
                            )}
                          >
                            {format(day, 'd')}
                          </span>
                        </div>

                        {/* 단일일 플랜 — 데스크탑: 텍스트 바 / 모바일: dot 패턴 */}
                        <div className="hidden md:block px-1 pb-1 space-y-0.5 min-h-10">
                          {dayPlans.slice(0, 3).map((plan) => (
                            <div
                              key={plan.id}
                              className={cn('text-xs px-1.5 py-0.5 rounded truncate', plan.isCompleted && 'opacity-50')}
                              style={{
                                backgroundColor: plan.color + '22',
                                borderLeft: `2px solid ${plan.color}`,
                                color: plan.color,
                              }}
                              onClick={(e) => { e.stopPropagation(); selectDate(dayStr) }}
                              title={plan.title}
                            >
                              {!plan.isAllDay && plan.startTime && (
                                <span className="mr-1 opacity-70">{plan.startTime.slice(0, 5)}</span>
                              )}
                              {plan.title}
                            </div>
                          ))}
                          {dayPlans.length > 3 && (
                            <div className="text-xs text-gray-400 px-1">+{dayPlans.length - 3} 더보기</div>
                          )}
                        </div>
                        {/* 모바일 dot 패턴 — 최대 4개 + 오버플로 +N (네이티브 캘린더 스타일) */}
                        <div className="md:hidden flex items-center justify-center gap-1.5 pb-2 pt-0.5 min-h-4">
                          {dayPlans.slice(0, 4).map((plan) => (
                            <span
                              key={plan.id}
                              className={cn(
                                'rounded-full shadow-sm transition-opacity',
                                isToday ? 'w-3 h-3' : 'w-2.5 h-2.5',
                                plan.isCompleted && 'opacity-40',
                                isSelected && 'ring-1 ring-offset-1 ring-violet-400 dark:ring-offset-violet-950',
                              )}
                              style={{
                                backgroundColor: plan.color,
                                // 어두운 배경에서 색이 더 또렷하게 — 내부 하이라이트
                                boxShadow: `inset 0 0 0 1px ${plan.color}, 0 1px 2px rgba(0,0,0,0.3)`,
                              }}
                              title={plan.title}
                            />
                          ))}
                          {dayPlans.length > 4 && (
                            <span className="text-[10px] font-semibold text-gray-500 dark:text-gray-400 leading-none ml-0.5">
                              +{dayPlans.length - 4}
                            </span>
                          )}
                        </div>
                      </div>
                    )
                  })}

                  {/* 범위 플랜 바 오버레이 */}
                  {rangePlans.map(({ plan, startCol, endCol, slot }) => (
                    <RangeBar
                      key={`${plan.id}-${wi}`}
                      plan={plan}
                      startCol={startCol}
                      endCol={endCol}
                      slot={slot}
                      onClick={() => selectDate(format(week[startCol], 'yyyy-MM-dd'))}
                    />
                  ))}
                </div>
              </div>
            )
          })}

          {/* 주 뷰 */}
          {viewMode === 'week' && (
            <WeekView
              weekStart={currentWeek}
              plans={expandedPlans}
              today={today}
              selectedDate={selectedDate}
              onSelectDate={selectDate}
              onNewPlan={(date, time) => {
                selectDate(date)
                setFormState({ open: true, date, initialTime: time })
              }}
              onEditPlan={(plan) => setFormState({ open: true, date: plan.date ?? selectedDate, plan })}
            />
          )}

          {/* 일 뷰 */}
          {viewMode === 'day' && (
            <DayView
              date={selectedDate || today}
              plans={expandedPlans}
              onNewPlan={(date, time) => setFormState({ open: true, date, initialTime: time })}
              onEditPlan={(plan) => setFormState({ open: true, date: plan.date ?? selectedDate, plan })}
            />
          )}
        </div>
      </div>

      {/* 플랜 패널 — 데스크탑: 사이드, 모바일: 바텀 시트 */}
      {panelOpen && (
        <>
          {/* 모바일 오버레이 배경 — 일 뷰에서는 헤더의 chevron 버튼을 가려서
              navigation을 막아버리는 버그 때문에 제외. 일 뷰는 day grid 자체가
              주 뷰이고 panel은 보조 정보라 backdrop 없이 노출. 닫기는 swipe-down + X로. */}
          {viewMode !== 'day' && (
            <div
              className="fixed inset-0 z-30 bg-black/30 md:hidden"
              onClick={handlePanelClose}
            />
          )}
          <div className="fixed bottom-16 left-0 right-0 z-40 md:static md:z-auto md:flex-shrink-0">
            <PlanPanel
              date={selectedDate}
              onNewPlan={() => setFormState({ open: true, date: selectedDate })}
              onEditPlan={(plan) => setFormState({ open: true, date: selectedDate, plan })}
              onClose={handlePanelClose}
            />
          </div>
        </>
      )}

      {/* 플랜 작성 모달 */}
      {formState.open && (
        <PlanFormModal
          date={formState.date}
          plan={formState.plan}
          initialStartTime={formState.initialTime}
          onClose={() => setFormState({ open: false, date: '' })}
          onSaved={() => { setFormState({ open: false, date: '' }); load() }}
        />
      )}
    </div>
  )
}

function ViewModeDropdown({
  viewMode,
  onChange,
}: {
  viewMode: 'month' | 'week' | 'day'
  onChange: (mode: 'month' | 'week' | 'day') => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [open])

  const labels = { month: '월', week: '주', day: '일' } as const

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-0.5 px-2 py-1 text-xs font-medium rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
      >
        <span>{labels[viewMode]}</span>
        <ChevronDown size={10} className={cn('transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-1 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 w-20">
          {(['month', 'week', 'day'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => { onChange(mode); setOpen(false) }}
              className={cn(
                'w-full px-3 py-1.5 text-xs text-left transition-colors',
                viewMode === mode
                  ? 'bg-violet-50 dark:bg-violet-950/30 text-violet-600 dark:text-violet-400 font-medium'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
              )}
            >
              {labels[mode]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
