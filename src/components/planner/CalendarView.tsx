'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  format, startOfMonth, endOfMonth,
  startOfWeek, endOfWeek, eachDayOfInterval,
  isSameMonth, addMonths, subMonths, addWeeks, subWeeks, addDays, subDays, parseISO, isSameWeek,
} from 'date-fns'
import { computeRangeBars } from '@/lib/planner/rangeBars'
import { ko } from 'date-fns/locale'
import { ChevronLeft, ChevronRight, ChevronDown, RefreshCw, Inbox, BarChart3 } from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { usePlannerStore } from '@/store/plannerStore'
import { usePlanner, useInboxQuery, useTodayListQuery } from '@/hooks/usePlanner'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useExpandedPlans } from '@/hooks/useExpandedPlans'
import { useSwipeGesture } from '@/hooks/useSwipeGesture'
import RangeBar from './RangeBar'
import PlanPanel from './PlanPanel'
import PlanFormModal from './PlanFormModal'
import WeekView from './WeekView'
import DayView from './DayView'
import InboxPanel from './InboxPanel'
import ScheduleSheet from './ScheduleSheet'
import PlanQuickEdit from './PlanQuickEdit'
import DayCloseModal from './DayCloseModal'
import { lsDayClosed } from '@/lib/cache/lsKeys'
import { useInboxDragStore } from '@/store/inboxDragStore'
import { undoLastPlanAction } from '@/lib/planner/planUndo'
import { minToTime } from '@/lib/planner/inbox'
import { toast } from '@/components/ui/Toast'
import type { Plan } from '@/types'
import { plainTitle } from '@/lib/planner/titleTokens'

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']
const MAX_RANGE_BARS = 3

export default function CalendarView() {
  const {
    selectedDate, selectDate,
    currentMonth, setCurrentMonth,
    currentWeek, setCurrentWeek,
    viewMode, setViewMode,
  } = usePlannerStore()

  const { refresh } = usePlanner()

  // ── 인박스 (2026-11) — 데스크톱 좌측 패널(열림 상태 기억) / 모바일 전체 시트 ──
  const { plans: inboxPlans } = useInboxQuery()
  const inboxCount = inboxPlans.filter((p) => !p.isCompleted).length
  const [inboxOpen, setInboxOpen] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true
    try { return localStorage.getItem('weave:planner-inbox-open') !== '0' } catch { return true }
  })
  const [mobileInboxOpen, setMobileInboxOpen] = useState(false)
  const [scheduleTarget, setScheduleTarget] = useState<Plan | null>(null)
  const modalOpenRef = useRef(false)
  // 블록 빠른 편집 — 누른 위치 옆에 띄우기 위해 마지막 포인터 좌표를 기억
  const [quickEdit, setQuickEdit] = useState<{ plan: Plan; anchor: { x: number; y: number } | null } | null>(null)
  const lastPointer = useRef<{ x: number; y: number } | null>(null)
  useEffect(() => {
    const onDown = (e: PointerEvent) => { lastPointer.current = { x: e.clientX, y: e.clientY } }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [])
  const openQuickEdit = (plan: Plan) => setQuickEdit({ plan, anchor: lastPointer.current })

  // ── 하루 마감 (2026-11) — 오늘 할 일의 마지막 하나를 완료하는 '순간'에 한 번 자동으로 띄운다.
  // 페이지를 열었을 때 이미 다 끝나 있던 경우는 띄우지 않는다(처음 받은 상태는 기준값으로만 기억).
  const dayKey = format(new Date(), 'yyyy-MM-dd')
  const { today: todayList, isLoading: todayLoading } = useTodayListQuery(dayKey)
  const [dayCloseOpen, setDayCloseOpen] = useState(false)
  const prevAllDone = useRef<boolean | null>(null)
  const prevDoneCount = useRef(0)
  const markDayClosed = () => {
    try { const k = lsDayClosed(dayKey); if (k) localStorage.setItem(k, '1') } catch { /* 무시 */ }
  }
  useEffect(() => {
    if (todayLoading) return
    const allDone = todayList.length > 0 && todayList.every((p) => p.isCompleted)
    let already = false
    try { const k = lsDayClosed(dayKey); already = !!k && localStorage.getItem(k) === '1' } catch { /* 무시 */ }
    const doneCount = todayList.filter((p) => p.isCompleted).length
    // '완료해서' 전부 끝났을 때만 — 남은 하나를 지우거나 미뤄서 전부 끝난 것처럼 보이는 경우는 제외
    const completedJustNow = doneCount > prevDoneCount.current
    prevDoneCount.current = doneCount
    if (prevAllDone.current === false && allDone && completedJustNow && !already) {
      // 완료 상태 전이(미완료→전부 완료)에 반응하는 1회성 열기
      setDayCloseOpen(true)
    }
    prevAllDone.current = allDone
  }, [todayList, todayLoading, dayKey])
  const [inboxFocus, setInboxFocus] = useState(0)
  const dragTarget = useInboxDragStore((s) => s.target)

  function toggleInbox() {
    if (window.matchMedia('(min-width: 768px)').matches) {
      setInboxOpen((v) => {
        try { localStorage.setItem('weave:planner-inbox-open', v ? '0' : '1') } catch { /* 무시 */ }
        return !v
      })
    } else {
      setMobileInboxOpen(true)
    }
  }

  // 단축키 — C: 인박스 빠른 추가 / ⌘·Ctrl+Z: 마지막 플랜 조작 되돌리기 (입력 중엔 무시)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null
      const typing = !!t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))
      if (typing) return
      // 모달(플랜 폼·일정 시트)이 떠 있으면 뒤 화면 단축키는 끈다
      if (modalOpenRef.current) return
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
        void undoLastPlanAction()
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'c' || e.key === 'C') {
        e.preventDefault()
        if (window.matchMedia('(min-width: 768px)').matches) {
          setInboxOpen(true)
          try { localStorage.setItem('weave:planner-inbox-open', '1') } catch { /* 무시 */ }
        } else {
          setMobileInboxOpen(true)
        }
        setInboxFocus((n) => n + 1)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  // 반복 플랜 전개 — RQ 플랜 + 완료맵에서 파생 (상태 이중화 정리 2단계)
  const { expandedPlans } = useExpandedPlans()

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

  const [formState, setFormState] = useState<{ open: boolean; date: string; plan?: Plan; initialTime?: string; initialEndTime?: string }>({
    open: false, date: '',
  })
  useEffect(() => { modalOpenRef.current = formState.open || !!scheduleTarget || !!quickEdit || dayCloseOpen }, [formState.open, scheduleTarget, quickEdit, dayCloseOpen])
  const [syncing, setSyncing] = useState(false)
  // Google Calendar는 선택 기능 — 설정에서 연결한 사용자에게만 동기화 버튼을 보인다 (2026-11)
  const { data: calendarConnected = false } = useQuery({
    queryKey: ['integrations', 'google_calendar'],
    queryFn: async () => {
      const { data } = await createClient()
        .from('user_integrations')
        .select('provider')
        .eq('provider', 'google_calendar')
        .limit(1)
      return (data ?? []).length > 0
    },
    // 설정에서 연결을 끊고 바로 돌아와도 옛 '연결됨'으로 버튼이 보이지 않게 — 화면에 올 때마다 확인
    staleTime: 0,
  })
  // 마지막 성공 동기화 시각 (ISO) — 새로고침에도 유지되도록 localStorage 미러
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(() =>
    typeof window !== 'undefined' ? localStorage.getItem('weave:planner-last-sync') : null,
  )

  async function handleSync() {
    setSyncing(true)
    try {
      let busyOnly = false
      try { busyOnly = localStorage.getItem('weave:gcal-busy-only') === '1' } catch { /* 무시 */ }
      const res = await fetch('/api/calendar/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ busyOnly }),
      })
      const json = await res.json()
      if (!res.ok) {
        if (json.error === 'Google Calendar not connected') {
          toast.info('Google Calendar 연결이 필요해요. 잠시 후 인증 페이지로 이동해요.')
          // 사용자가 토스트를 확인할 수 있도록 600ms 대기 후 이동
          window.setTimeout(() => { window.location.href = '/api/calendar/auth' }, 600)
        } else {
          toast.error('동기화 중 오류가 발생했습니다.')
        }
        return
      }
      await refresh()
      const now = new Date().toISOString()
      setLastSyncAt(now)
      try { localStorage.setItem('weave:planner-last-sync', now) } catch { /* quota 등 무시 */ }
      toast.success(`Google Calendar 동기화 완료 (${json.synced}개 추가)`)
    } catch {
      toast.error('동기화 중 오류가 발생했습니다.')
    } finally {
      setSyncing(false)
    }
  }

  const today = format(new Date(), 'yyyy-MM-dd')
  // "오늘" 버튼 비활성 판정 — 뷰별로 다름.
  // 이전엔 selectedDate === today만 봐서, 월 뷰에서 오늘을 클릭한 뒤
  // 다른 달로 이동해도 selectedDate가 today로 남아 버튼이 계속 disabled였음.
  const todayDate = new Date()
  const isViewingToday =
    viewMode === 'month'
      ? isSameMonth(currentMonth, todayDate)
      : viewMode === 'week'
        ? isSameWeek(currentWeek, todayDate, { weekStartsOn: 0 })
        : selectedDate === today

  function goToToday() {
    const now = new Date()
    setCurrentMonth(now)
    setCurrentWeek(startOfWeek(now, { weekStartsOn: 0 }))
    selectDate(today)
  }

  // 뷰 모드 전환 시 기간 동기화 — 보고 있던 날짜(선택일, 없으면 현재 기간 기준점)가
  // 새 뷰에서도 보이도록 currentMonth/currentWeek을 정렬한다. 이전엔 월에서 10월을
  // 보다가 주로 바꾸면 엉뚱한 (마지막으로 보던) 주가 떴음. 일뷰 전환은 기존대로
  // selectedDate || today 기준이라 별도 처리 불필요.
  function changeViewMode(mode: 'month' | 'week' | 'day') {
    if (mode !== viewMode) {
      const anchor = selectedDate
        ? parseISO(selectedDate)
        : viewMode === 'month' ? startOfMonth(currentMonth)
          : viewMode === 'week' ? currentWeek
            : parseISO(today)
      if (mode === 'month') setCurrentMonth(anchor)
      else if (mode === 'week') setCurrentWeek(startOfWeek(anchor, { weekStartsOn: 0 }))
    }
    setViewMode(mode)
  }

  // 주/월 네비 시 우측 플랜 패널 날짜 동기화 — 패널이 열려 있을 때만.
  // 일뷰 네비는 selectedDate 자체를 옮기지만, 주/월 네비는 currentWeek/currentMonth만
  // 갱신해 패널이 이전 기간 날짜에 고착돼 있었다. 오늘이 새 기간 안이면 오늘,
  // 아니면 기간 첫날로 옮긴다 (패널이 닫혀 있으면 열지 않음 — 빈 selectedDate 유지).
  function syncPanelToPeriod(periodStart: Date, periodEnd: Date) {
    if (!selectedDate) return
    const startStr = format(periodStart, 'yyyy-MM-dd')
    const endStr = format(periodEnd, 'yyyy-MM-dd')
    selectDate(today >= startStr && today <= endStr ? today : startStr)
  }

  // 이전/다음 — 헤더 버튼 + 모바일 스와이프 공용
  function goPrev() {
    if (viewMode === 'month') {
      const m = subMonths(currentMonth, 1)
      setCurrentMonth(m)
      syncPanelToPeriod(startOfMonth(m), endOfMonth(m))
    } else if (viewMode === 'week') {
      const w = subWeeks(currentWeek, 1)
      setCurrentWeek(w)
      syncPanelToPeriod(w, addDays(w, 6))
    } else selectDate(format(subDays(parseISO(selectedDate || today), 1), 'yyyy-MM-dd'))
  }
  function goNext() {
    if (viewMode === 'month') {
      const m = addMonths(currentMonth, 1)
      setCurrentMonth(m)
      syncPanelToPeriod(startOfMonth(m), endOfMonth(m))
    } else if (viewMode === 'week') {
      const w = addWeeks(currentWeek, 1)
      setCurrentWeek(w)
      syncPanelToPeriod(w, addDays(w, 6))
    } else selectDate(format(addDays(parseISO(selectedDate || today), 1), 'yyyy-MM-dd'))
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
  // 슬롯 로직은 주뷰 종일 레인과 공용 단일 출처 — lib/planner/rangeBars.ts
  // (2026-08 "자리가 남는데도 누락" 수정판: 시작일 정렬 + 줄 수 기준 상한 + hidden)
  function getWeekRangePlans(week: Date[]) {
    const weekStrs = week.map((d) => format(d, 'yyyy-MM-dd'))
    return computeRangeBars(weekStrs, expandedPlans, MAX_RANGE_BARS)
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

  // 주/월 뷰: 우측 패널을 선택일 하루치가 아니라 기간 전체 플랜 모드로
  const panelPeriod = viewMode === 'week'
    ? {
        start: format(currentWeek, 'yyyy-MM-dd'),
        end: format(addDays(currentWeek, 6), 'yyyy-MM-dd'),
        label: `${format(currentWeek, 'M월 d일', { locale: ko })} – ${format(addDays(currentWeek, 6), 'M월 d일', { locale: ko })}`,
      }
    : viewMode === 'month'
      ? {
          start: format(startOfMonth(currentMonth), 'yyyy-MM-dd'),
          end: format(endOfMonth(currentMonth), 'yyyy-MM-dd'),
          label: format(currentMonth, 'yyyy년 M월', { locale: ko }),
        }
      : null

  return (
    <div className="flex h-full overflow-hidden">
      {/* 인박스 — 데스크톱 좌측 패널 */}
      {inboxOpen && (
        <div className="hidden md:flex h-full flex-shrink-0">
          <InboxPanel
            variant="side"
            focusSignal={inboxFocus}
            onSchedule={setScheduleTarget}
            onEditPlan={(plan) => setFormState({ open: true, date: plan.date ?? today, plan })}
            onCloseDay={() => setDayCloseOpen(true)}
          />
        </div>
      )}

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
            {/* 인박스 열기/닫기 — 데스크톱은 좌측 패널 토글, 모바일은 시트 */}
            <button
              type="button"
              onClick={toggleInbox}
              aria-pressed={inboxOpen}
              aria-label={`인박스 ${inboxCount}개`}
              title="인박스 (C로 빠른 추가)"
              className={cn(
                'flex items-center gap-1.5 text-xs font-medium px-2 sm:px-2.5 py-1 rounded-lg border transition-colors',
                'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800',
                inboxOpen && 'md:border-violet-300 md:text-violet-700 md:bg-violet-50 dark:md:bg-violet-950/30 dark:md:text-violet-300',
              )}
            >
              <Inbox size={13} className="flex-shrink-0" aria-hidden="true" />
              <span className="hidden sm:inline">인박스</span>
              {inboxCount > 0 && <span className="tabular-nums">{inboxCount}</span>}
            </button>

            {/* 주간 돌아보기 */}
            <Link
              href="/planner/review"
              aria-label="주간 돌아보기"
              title="주간 돌아보기"
              className="flex items-center gap-1.5 text-xs font-medium px-2 sm:px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              <BarChart3 size={13} className="flex-shrink-0" aria-hidden="true" />
              <span className="hidden lg:inline">돌아보기</span>
            </Link>

            {/* Google Calendar 동기화 — 연결한 사용자만 */}
            {calendarConnected && <button
              onClick={handleSync}
              disabled={syncing}
              title={lastSyncAt
                ? `Google Calendar 동기화 — 마지막: ${format(parseISO(lastSyncAt), 'M/d HH:mm')}`
                : 'Google Calendar 동기화'}
              className="flex items-center gap-1.5 text-xs font-medium px-2 sm:px-2.5 py-1 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors disabled:opacity-50"
            >
              <RefreshCw size={13} className={cn('flex-shrink-0', syncing && 'animate-spin')} />
              {/* 모바일도 한 줄 라벨 — 2줄(10px) 스택은 우측 뷰 셀렉터와 높이/톤이 어긋났음 */}
              <span className="hidden sm:inline">Google 동기화</span>
              <span className="sm:hidden">동기화</span>
            </button>}

            {/* 데스크톱: 평탄 뷰 토글 */}
            <div className="hidden sm:flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
              {(['month', 'week', 'day'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => changeViewMode(mode)}
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
              <ViewModeDropdown viewMode={viewMode} onChange={changeViewMode} />
            </div>
          </div>
        </div>

        {/* 그리드 영역 래퍼 — 모바일 바텀시트 backdrop의 absolute 기준. 헤더는 래퍼
            밖이라 backdrop이 못 덮는다 (top 오프셋 하드코딩 없이 구조로 해결) */}
        <div className="relative flex-1 flex flex-col overflow-hidden">
        {/* 요일 헤더 — 월뷰 전용. 주뷰는 시간 열(w-14) 오프셋을 아는 WeekView가 자체
            렌더(전역 7등분 행은 컬럼과 어긋남), 일뷰는 단일 날짜라 요일 행이 정보 가치가
            없고 헤더의 'M/d (요일)' 표기가 이미 요일을 담당 → 둘 다 제거 */}
        {viewMode === 'month' && (
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
        )}

        {/* 달력 그리드 (모바일 스와이프 핸들러 부착) */}
        <div
          ref={swipeRef}
          className="flex-1 overflow-auto"
          onClickCapture={onSwipeClickCapture}
        >
          {viewMode === 'month' && weeks.map((week, wi) => {
            const { bars: rangePlans, hidden: hiddenRangeCount } = getWeekRangePlans(week)
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

                    const isDropTarget = dragTarget?.kind === 'allday' && dragTarget.date === dayStr
                    return (
                      <div
                        key={di}
                        data-drop-kind="allday"
                        data-drop-day={dayStr}
                        className={cn(
                          'border-r border-gray-100 dark:border-gray-800 cursor-pointer transition-colors',
                          isDropTarget && 'ring-2 ring-inset ring-violet-400 bg-violet-50/70 dark:bg-violet-950/30',
                          !inMonth && 'bg-gray-50/60 dark:bg-gray-900/60',
                          isSelected && 'bg-violet-50/60 dark:bg-violet-950/20',
                          !isSelected && inMonth && 'hover:bg-gray-50 dark:hover:bg-gray-800/40',
                          di === 6 && 'border-r-0'
                        )}
                        style={{ paddingTop: `${barAreaHeight}px` }}
                        // 데스크탑(md↑, 칩 레이아웃): 날짜 클릭 = 바로 새 플랜 폼. 날짜도 선택해 두어
                        // 폼을 닫으면 그 날 플랜 패널이 남는다(기존 플랜 확인은 칩·범위 바·더보기).
                        // 모바일(dot 레이아웃): 플랜을 따로 누를 수 없어 기존대로 날짜 선택 토글(패널).
                        onClick={() => {
                          if (window.matchMedia('(min-width: 768px)').matches) {
                            selectDate(dayStr)
                            setFormState({ open: true, date: dayStr })
                          } else {
                            selectDate(isSelected ? '' : dayStr)
                          }
                        }}
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
                              title={plainTitle(plan.title)}
                            >
                              {!plan.isAllDay && plan.startTime && (
                                <span className="mr-1 opacity-70">{plan.startTime.slice(0, 5)}</span>
                              )}
                              {plainTitle(plan.title)}
                            </div>
                          ))}
                          {dayPlans.length > 3 && (
                            <div
                              className="text-xs text-gray-400 px-1 hover:text-gray-600 dark:hover:text-gray-300"
                              onClick={(e) => { e.stopPropagation(); selectDate(dayStr) }}
                            >
                              +{dayPlans.length - 3} 더보기
                            </div>
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
                              title={plainTitle(plan.title)}
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
                  {rangePlans.map(({ plan, startCol, endCol, slot, continuesLeft, continuesRight }) => (
                    <RangeBar
                      key={`${plan.id}-${wi}`}
                      plan={plan}
                      startCol={startCol}
                      endCol={endCol}
                      slot={slot}
                      continuesLeft={continuesLeft}
                      continuesRight={continuesRight}
                      onClick={() => selectDate(format(week[startCol], 'yyyy-MM-dd'))}
                    />
                  ))}

                  {/* 줄 수 상한으로 숨긴 범위 플랜 — 침묵 누락 방지 */}
                  {hiddenRangeCount > 0 && (
                    <div
                      className="absolute right-1 z-20 text-[10px] font-medium px-1 rounded bg-gray-200/90 text-gray-600 dark:bg-gray-700/90 dark:text-gray-300"
                      style={{ top: `${2 + (MAX_RANGE_BARS - 1) * 22}px` }}
                      title={`이 주에 ${hiddenRangeCount}개의 범위 플랜이 더 있습니다 (날짜를 클릭하면 전체 목록이 보입니다)`}
                    >
                      +{hiddenRangeCount}
                    </div>
                  )}
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
              onNewPlan={(date, startTime, endTime) => {
                selectDate(date)
                setFormState({ open: true, date, initialTime: startTime, initialEndTime: endTime })
              }}
              onEditPlan={openQuickEdit}
            />
          )}

          {/* 일 뷰 */}
          {viewMode === 'day' && (
            <DayView
              date={selectedDate || today}
              plans={expandedPlans}
              onNewPlan={(date, startTime, endTime) => setFormState({ open: true, date, initialTime: startTime, initialEndTime: endTime })}
              onEditPlan={openQuickEdit}
            />
          )}
        </div>

        {/* 모바일 바텀시트 backdrop — 기존 fixed inset-0은 헤더까지 덮어 뷰 전환·이전/다음·
            오늘·동기화 버튼의 첫 탭을 삼켰음(<768px, 특히 640~767px에선 셀렉터가 보이는데
            첫 클릭 불가). 그리드 영역만 absolute로 덮어 헤더 조작은 첫 탭에 먹히고,
            바깥 탭으로 닫기 + 딤 처리는 유지. 일 뷰는 기존대로 backdrop 없음. */}
        {panelOpen && viewMode !== 'day' && (
          <div
            className="absolute inset-0 z-30 bg-black/30 md:hidden"
            onClick={handlePanelClose}
          />
        )}
        </div>
      </div>

      {/* 플랜 패널 — 데스크탑: 사이드, 모바일: 바텀 시트 */}
      {panelOpen && (
        <>
          {/* backdrop은 그리드 영역 래퍼 안(absolute)으로 이동 — 헤더 첫 탭 삼킴 해소.
              md:h-full: 데스크탑에서 패널 루트에 높이 기준을 줘야 내부 flex-1 목록이 스크롤됨 */}
          <div className="fixed bottom-16 left-0 right-0 z-40 md:static md:z-auto md:h-full md:flex-shrink-0">
            <PlanPanel
              date={selectedDate}
              periodStart={panelPeriod?.start}
              periodEnd={panelPeriod?.end}
              periodLabel={panelPeriod?.label}
              onNewPlan={() => setFormState({ open: true, date: selectedDate })}
              onEditPlan={(plan) => setFormState({ open: true, date: selectedDate, plan })}
              onClose={handlePanelClose}
            />
          </div>
        </>
      )}

      {/* 인박스 — 모바일 전체 시트 (하단 내비 위까지) */}
      {mobileInboxOpen && (
        <div className="fixed inset-x-0 top-0 bottom-16 z-50 md:hidden flex flex-col bg-white dark:bg-gray-900">
          <InboxPanel
            variant="sheet"
            focusSignal={inboxFocus}
            onClose={() => setMobileInboxOpen(false)}
            onSchedule={setScheduleTarget}
            onEditPlan={(plan) => setFormState({ open: true, date: plan.date ?? today, plan })}
            onCloseDay={() => setDayCloseOpen(true)}
          />
        </div>
      )}

      {/* 인박스 항목 '언제 할까요?' */}
      {scheduleTarget && (
        <ScheduleSheet
          plan={scheduleTarget}
          onClose={() => setScheduleTarget(null)}
          onEdit={(plan) => {
            setScheduleTarget(null)
            setFormState({ open: true, date: plan.date ?? today, plan })
          }}
        />
      )}

      {/* 하루 마감 */}
      {dayCloseOpen && (
        <DayCloseModal
          day={dayKey}
          onClose={() => { markDayClosed(); setDayCloseOpen(false) }}
        />
      )}

      {/* 블록 빠른 편집 */}
      {quickEdit && (
        <PlanQuickEdit
          key={quickEdit.plan.id + (quickEdit.plan.date ?? '')}
          plan={quickEdit.plan}
          anchor={quickEdit.anchor}
          onClose={() => setQuickEdit(null)}
          onFullEdit={(plan) => {
            setQuickEdit(null)
            setFormState({ open: true, date: plan.date ?? selectedDate ?? today, plan })
          }}
        />
      )}

      {/* 인박스 드래그 고스트 — 커서 좌표 구독은 이 작은 컴포넌트만 (캘린더 전체 재렌더 방지) */}
      <InboxDragGhost />

      {/* 플랜 작성 모달 */}
      {formState.open && (
        <PlanFormModal
          date={formState.date}
          plan={formState.plan}
          initialStartTime={formState.initialTime}
            initialEndTime={formState.initialEndTime}
          onClose={() => setFormState({ open: false, date: '' })}
          onSaved={() => { setFormState({ open: false, date: '' }); refresh() }}
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

/** 인박스 드래그 고스트 — 놓일 자리를 글로 보여준다. 화면 밖으로 넘치지 않게 끼운다 */
function InboxDragGhost() {
  const planId = useInboxDragStore((s) => s.planId)
  const title = useInboxDragStore((s) => s.title)
  const x = useInboxDragStore((s) => s.x)
  const y = useInboxDragStore((s) => s.y)
  const target = useInboxDragStore((s) => s.target)
  if (!planId) return null
  return (
    <div
      className="fixed z-[70] pointer-events-none px-3 py-2 rounded-lg bg-white dark:bg-gray-800 border border-violet-200 dark:border-violet-800 shadow-lg text-sm max-w-56 -rotate-2"
      style={{ left: Math.min(x + 12, window.innerWidth - 236), top: Math.min(y + 8, window.innerHeight - 64) }}
      aria-hidden="true"
    >
      <div className="font-semibold truncate text-gray-900 dark:text-gray-100">{plainTitle(title)}</div>
      <div className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
        {target
          ? target.kind === 'timed'
            ? `${format(parseISO(target.date), 'M/d (eee)', { locale: ko })} ${minToTime(target.startMin)} · 1시간`
            : `${format(parseISO(target.date), 'M/d (eee)', { locale: ko })} 종일`
          : '캘린더에 놓으면 일정이 정해져요'}
      </div>
    </div>
  )
}
