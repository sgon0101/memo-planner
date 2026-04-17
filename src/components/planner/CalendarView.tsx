'use client'

import { useState, useMemo } from 'react'
import {
  format, startOfMonth, endOfMonth,
  startOfWeek, endOfWeek, eachDayOfInterval,
  isSameMonth, isSameDay, addMonths, subMonths, parseISO,
} from 'date-fns'
import { ko } from 'date-fns/locale'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { usePlannerStore } from '@/store/plannerStore'
import { usePlanner } from '@/hooks/usePlanner'
import RangeBar from './RangeBar'
import PlanPanel from './PlanPanel'
import PlanFormModal from './PlanFormModal'
import type { Plan } from '@/types'

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']
const MAX_RANGE_BARS = 3

export default function CalendarView() {
  const {
    plans, selectedDate, selectDate,
    currentMonth, setCurrentMonth,
    viewMode, setViewMode,
  } = usePlannerStore()

  const { load } = usePlanner()

  const [formState, setFormState] = useState<{ open: boolean; date: string; plan?: Plan }>({
    open: false, date: '',
  })

  const today = format(new Date(), 'yyyy-MM-dd')

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

  // 특정 날짜의 단일일 플랜
  function getDayPlans(dayStr: string): Plan[] {
    return plans.filter((p) => p.date === dayStr)
  }

  // 특정 주에 걸리는 범위 플랜 (startCol, endCol, slot 포함)
  function getWeekRangePlans(week: Date[]) {
    const weekStrs = week.map((d) => format(d, 'yyyy-MM-dd'))
    const weekStart = weekStrs[0]
    const weekEnd = weekStrs[6]

    const overlapping = plans
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

  const panelOpen = !!selectedDate

  return (
    <div className="flex h-full overflow-hidden">
      {/* 캘린더 메인 */}
      <div className="flex-1 flex flex-col overflow-hidden bg-white dark:bg-gray-900">
        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 dark:border-gray-800 flex-shrink-0">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400 transition-colors"
            >
              <ChevronLeft size={16} />
            </button>
            <h2 className="text-base font-semibold text-gray-900 dark:text-white w-28 text-center">
              {format(currentMonth, 'yyyy년 M월', { locale: ko })}
            </h2>
            <button
              onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400 transition-colors"
            >
              <ChevronRight size={16} />
            </button>
            <button
              onClick={() => { setCurrentMonth(new Date()); selectDate(today) }}
              className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              오늘
            </button>
          </div>

          {/* 뷰 토글 */}
          <div className="flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
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

        {/* 달력 그리드 */}
        <div className="flex-1 overflow-auto">
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

                        {/* 단일일 플랜 */}
                        <div className="px-1 pb-1 space-y-0.5 min-h-10">
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

          {/* 주 뷰 placeholder */}
          {viewMode === 'week' && (
            <div className="flex items-center justify-center h-full text-gray-400 text-sm">
              주 뷰 — 준비 중
            </div>
          )}

          {/* 일 뷰 placeholder */}
          {viewMode === 'day' && (
            <div className="flex items-center justify-center h-full text-gray-400 text-sm">
              일 뷰 — 준비 중
            </div>
          )}
        </div>
      </div>

      {/* 플랜 패널 */}
      {panelOpen && (
        <PlanPanel
          date={selectedDate}
          onNewPlan={() => setFormState({ open: true, date: selectedDate })}
          onEditPlan={(plan) => setFormState({ open: true, date: selectedDate, plan })}
          onClose={() => selectDate('')}
        />
      )}

      {/* 플랜 작성 모달 */}
      {formState.open && (
        <PlanFormModal
          date={formState.date}
          plan={formState.plan}
          onClose={() => setFormState({ open: false, date: '' })}
          onSaved={() => { setFormState({ open: false, date: '' }); load() }}
        />
      )}
    </div>
  )
}
