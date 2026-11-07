'use client'

/**
 * 인박스 / 오늘 패널 (2026-11 플래너 개선 1차).
 *
 * - 인박스: 시간 미정 플랜. 빠른 추가는 "내일 3시"·"11/20" 같은 표현을 바로 해석한다.
 *   데스크톱은 항목을 캘린더(주·일·월뷰)로 끌어 놓아 일정을 정하고, 탭/클릭은 일정 시트를 연다.
 * - 오늘: 지난 미완료 + 오늘 플랜. 완료 체크, 지난 항목 '오늘로'.
 * 모든 일정 변경은 usePlanner.schedulePlan → 실행 취소 토스트.
 */

import { useEffect, useRef, useState } from 'react'
import { format, parseISO } from 'date-fns'
import { X, CornerDownLeft, ArrowRight, Inbox as InboxIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { usePlanner, useInboxQuery, useTodayListQuery } from '@/hooks/usePlanner'
import { parseQuickAdd } from '@/lib/planner/quickAdd'
import { minToTime, INBOX_RESET_FIELDS } from '@/lib/planner/inbox'
import { plainTitle, splitWikisFromText } from '@/lib/planner/titleTokens'
import { usePlanHints } from '@/hooks/usePlanHints'
import { suggestWikis, colorForWiki } from '@/lib/planner/planHints'
import { resolveDropTarget } from '@/lib/planner/dropTarget'
import { DRAG_THRESHOLD_PX } from '@/lib/planner/dragHelpers'
import { pushPlanUndo } from '@/lib/planner/planUndo'
import { useInboxDragStore } from '@/store/inboxDragStore'
import { reportSaveError } from '@/lib/ui/reportSaveError'
import PlanTitle from './PlanTitle'
import PlannerGuide from './PlannerGuide'
import { markGuideStep } from '@/lib/planner/guide'
import type { Plan } from '@/types'

type Tab = 'inbox' | 'today'

interface InboxPanelProps {
  /** side: 데스크톱 좌측 패널(드래그 가능) / sheet: 모바일 전체 시트 */
  variant: 'side' | 'sheet'
  onClose?: () => void
  /** 인박스 항목 탭 — 일정 시트 열기 */
  onSchedule: (plan: Plan) => void
  /** 오늘 탭 항목 탭 — 편집 */
  onEditPlan: (plan: Plan) => void
  /** 'c' 단축키 등에서 입력창 포커스 요청 (값이 바뀔 때마다 포커스) */
  focusSignal?: number
  /** '오늘' 탭의 하루 마감 버튼 */
  onCloseDay?: () => void
}

function fmtDay(d: string): string {
  return format(parseISO(d), 'M/d')
}

export default function InboxPanel({ variant, onClose, onSchedule, onEditPlan, focusSignal, onCloseDay }: InboxPanelProps) {
  const [tab, setTab] = useState<Tab>('inbox')
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const submittingRef = useRef(false)
  const today = format(new Date(), 'yyyy-MM-dd')

  const { plans: inbox, isLoading: inboxLoading } = useInboxQuery()
  const { overdue, today: todayPlans } = useTodayListQuery(today)
  const { createPlan, editPlan, schedulePlan, toggleComplete, toggleRecurringComplete } = usePlanner()

  const openInbox = inbox.filter((p) => !p.isCompleted)
  const todayOpenCount = overdue.length + todayPlans.filter((p) => !p.isCompleted).length

  useEffect(() => {
    if (focusSignal === undefined || focusSignal === 0) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 단축키로 패널을 열 때 인박스 탭 + 입력 포커스 (1회성 신호)
    setTab('inbox')
    inputRef.current?.focus()
  }, [focusSignal])

  // [[위키]]는 칩으로 떼어 내고(제목에 남기지 않음) 나머지에서 날짜·시간을 읽는다
  const wikiSplit = splitWikisFromText(text.trim())
  const parsed = text.trim() ? parseQuickAdd(wikiSplit.title) : null
  // 위키를 안 적었으면 지난 비슷한 플랜의 위키를 추천(눌러서 붙임), 적은 위키는 그 위키에 많이 쓴 색으로 저장
  const hints = usePlanHints()
  const quickSuggest = parsed && !wikiSplit.wikis.length ? suggestWikis(hints, parsed.title, [], 1) : []
  const wikiColor = wikiSplit.wikis[0] ? colorForWiki(hints, wikiSplit.wikis[0]) ?? undefined : undefined

  async function submit(raw: boolean) {
    const value = text.trim()
    if (!value || submittingRef.current) return
    submittingRef.current = true
    setSaving(true)
    try {
      // '오늘' 탭에서 날짜 없이 적으면 오늘(종일)로 — 인박스로 사라지면 어색하다
      const fallbackDate = tab === 'today' ? today : null
      if (raw || !parsed) {
        await createPlan({ title: wikiSplit.title, wikiLinks: wikiSplit.wikis, color: wikiColor, date: raw ? null : fallbackDate, startDate: null, isAllDay: true })
      } else {
        const created = await createPlan({
          title: parsed.title,
          wikiLinks: wikiSplit.wikis,
          color: wikiColor,
          date: parsed.date ?? fallbackDate,
          startDate: null,
          startTime: parsed.startTime,
          endTime: parsed.endTime,
          isAllDay: parsed.isAllDay,
        })
        if (parsed.date && tab === 'inbox') {
          const when = parsed.startTime ? `${fmtDay(parsed.date)} ${parsed.startTime}` : fmtDay(parsed.date)
          pushPlanUndo(`'${plainTitle(created.title)}'을(를) ${when}에 넣었어요`, () => editPlan(created.id, INBOX_RESET_FIELDS))
        }
      }
      setText('')
      markGuideStep('capture')
    } catch (err) {
      reportSaveError('플랜을 추가하지 못했어요.')(err)
    } finally {
      submittingRef.current = false
      setSaving(false)
    }
  }

  /** 인박스 항목 완료 — 오늘 날짜로 기록되도록 오늘(종일)에 넣고 완료 (돌아보기·하루 마감 집계에 잡히게) */
  async function completeInbox(plan: Plan) {
    try {
      await editPlan(plan.id, { date: today, startDate: null, isAllDay: true, isCompleted: true })
      pushPlanUndo(`'${plainTitle(plan.title)}'을(를) 완료했어요`, () => editPlan(plan.id, { ...INBOX_RESET_FIELDS, isCompleted: false }))
    } catch (err) {
      reportSaveError('완료 처리하지 못했어요.')(err)
    }
  }

  async function toggleToday(plan: Plan) {
    try {
      if (plan.isRecurringInstance && plan.originalPlanId && plan.date) {
        await toggleRecurringComplete(plan.originalPlanId, plan.date, plan.isCompleted)
      } else {
        await toggleComplete(plan.id, plan.isCompleted)
      }
    } catch (err) {
      reportSaveError('완료 상태를 바꾸지 못했어요.')(err)
    }
  }

  async function moveToToday(plan: Plan) {
    try {
      await schedulePlan(plan, {
        date: today,
        startTime: plan.startTime,
        endTime: plan.endTime,
        isAllDay: plan.isAllDay,
      }, `'${plan.title}'을(를) 오늘로 옮겼어요`)
    } catch (err) {
      reportSaveError('오늘로 옮기지 못했어요.')(err)
    }
  }

  // ── 인박스 → 캘린더 드래그 (마우스·펜 전용. 터치는 탭 → 일정 시트) ──
  const dragStart = useInboxDragStore((s) => s.start)
  const dragMove = useInboxDragStore((s) => s.move)
  const dragEnd = useInboxDragStore((s) => s.end)
  const draggingId = useInboxDragStore((s) => s.planId)
  // 캘린더에서 끌어온 플랜이 이 패널 위에 있을 때 — 놓으면 인박스로
  const receiving = useInboxDragStore((s) => s.overInbox || (s.source === 'calendar' && s.target?.kind === 'inbox'))
  const cleanupRef = useRef<(() => void) | null>(null)
  const lastPointerType = useRef<string>('')
  useEffect(() => () => { cleanupRef.current?.() }, [])

  function onItemPointerDown(e: React.PointerEvent, plan: Plan) {
    if (variant !== 'side' || e.pointerType === 'touch' || e.button !== 0) return
    if ((e.target as HTMLElement).closest('button')) return
    const sx = e.clientX, sy = e.clientY
    let started = false
    const prevSelect = document.body.style.userSelect

    const onMove = (ev: PointerEvent) => {
      if (!started) {
        if (Math.abs(ev.clientX - sx) < DRAG_THRESHOLD_PX && Math.abs(ev.clientY - sy) < DRAG_THRESHOLD_PX) return
        started = true
        document.body.style.userSelect = 'none'
        dragStart(plan.id, plan.title, ev.clientX, ev.clientY)
      }
      dragMove(ev.clientX, ev.clientY, resolveDropTarget(ev.clientX, ev.clientY, 60))
    }
    const finish = async (ev: PointerEvent, cancelled: boolean) => {
      cleanup()
      if (!started) {
        if (!cancelled) onSchedule(plan) // 움직이지 않은 클릭 → 일정 시트
        return
      }
      const target = cancelled ? null : resolveDropTarget(ev.clientX, ev.clientY, 60)
      dragEnd()
      if (!target || target.kind === 'inbox') return
      try {
        if (target.kind === 'timed') {
          await schedulePlan(plan, {
            date: target.date,
            startTime: minToTime(target.startMin),
            endTime: minToTime(Math.min(target.startMin + 60, 24 * 60 - 1)),
            isAllDay: false,
          })
        } else {
          await schedulePlan(plan, { date: target.date, startTime: null, endTime: null, isAllDay: true })
        }
      } catch (err) {
        reportSaveError('일정을 정하지 못했어요.')(err)
      }
    }
    const onUp = (ev: PointerEvent) => { void finish(ev, false) }
    const onCancel = (ev: PointerEvent) => { void finish(ev, true) }
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') { cleanup(); dragEnd() }
    }
    function cleanup() {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      document.removeEventListener('pointercancel', onCancel)
      document.removeEventListener('keydown', onKey)
      document.body.style.userSelect = prevSelect
      cleanupRef.current = null
    }
    cleanupRef.current?.()
    cleanupRef.current = cleanup
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    document.addEventListener('pointercancel', onCancel)
    document.addEventListener('keydown', onKey)
  }

  const tabBtn = (t: Tab, label: string, count: number) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === t}
      onClick={() => setTab(t)}
      className={cn(
        'px-3 min-h-9 rounded-lg text-sm transition-colors',
        tab === t
          ? 'bg-violet-50 text-violet-700 font-semibold dark:bg-violet-950/40 dark:text-violet-300'
          : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800',
      )}
    >
      {label} {count > 0 && <span className="text-gray-400 font-normal">{count}</span>}
    </button>
  )

  return (
    <div
      // 캘린더 → 인박스 드래그의 놓을 자리 (데스크톱 좌측 패널만)
      data-drop-kind={variant === 'side' ? 'inbox' : undefined}
      className={cn(
        'relative flex flex-col bg-white dark:bg-gray-900',
        variant === 'side' ? 'w-72 h-full border-r border-gray-200 dark:border-gray-800' : 'h-full w-full',
      )}
    >
      {variant === 'side' && receiving && (
        <div className="pointer-events-none absolute inset-1.5 z-20 rounded-xl border-2 border-dashed border-violet-400 bg-violet-50/80 dark:bg-violet-950/60 flex items-center justify-center" aria-hidden="true">
          <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-violet-700 dark:text-violet-300">
            <InboxIcon size={15} /> 여기에 놓으면 인박스로
          </span>
        </div>
      )}
      <div className="flex items-center gap-1 px-3 pt-3 pb-2" role="tablist" aria-label="인박스와 오늘">
        {tabBtn('inbox', '인박스', openInbox.length)}
        {tabBtn('today', '오늘', todayOpenCount)}
        <div className="flex-1" />
        {variant === 'side' && <span className="text-[11px] text-gray-400 hidden lg:inline">C로 추가</span>}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="인박스 닫기"
            className="w-11 h-11 md:w-8 md:h-8 flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {/* 빠른 추가 */}
      <form
        className="px-3 pb-2"
        onSubmit={(e) => { e.preventDefault(); void submit(false) }}
        data-autofill-blocked="1"
      >
        <label htmlFor="inbox-quick-add" className="sr-only">플랜 빠른 추가</label>
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 focus-within:border-violet-400 focus-within:ring-2 focus-within:ring-violet-100 dark:focus-within:ring-violet-900/40 px-3 py-2 transition-colors">
          <input
            ref={inputRef}
            id="inbox-quick-add"
            type="search"
            autoComplete="off"
            data-form-type="other"
            data-1p-ignore=""
            data-autofill-blocked="1"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              // 한글 조합 중 Enter는 글자 확정용 — 제출하지 않는다 (확정 Enter와 겹쳐 두 번 저장되는 것 방지)
              if (e.key === 'Enter' && e.nativeEvent.isComposing) { e.preventDefault(); return }
              if (e.key === 'Enter' && e.shiftKey) { e.preventDefault(); void submit(true) }
              if (e.key === 'Escape') { setText(''); inputRef.current?.blur() }
            }}
            placeholder={tab === 'today' ? '+ 오늘 할 일 ("오늘"을 붙이면 오늘로)' : '+ 할 일 추가 (예: 보고서 초안 내일 3시)'}
            className="w-full bg-transparent text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 outline-none"
            disabled={saving}
          />
          {parsed && (
            <div className="flex flex-wrap items-center gap-1.5 mt-1.5 text-xs">
              {parsed.date || tab === 'today' ? (
                <span className="px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">
                  {parsed.date ? fmtDay(parsed.date) : '오늘'}{parsed.startTime ? ` ${parsed.startTime}–${parsed.endTime}` : ' 종일'}
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300">인박스</span>
              )}
              {quickSuggest.map((w) => (
                <button
                  key={`s-${w}`}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => { setText((t) => `${t.trimEnd()} [[${w}]]`); inputRef.current?.focus() }}
                  title="지난 비슷한 플랜에 단 위키예요"
                  className="px-2 py-0.5 rounded-full border border-dashed border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
                >
                  + {w} <span className="text-[10px] opacity-70">추천</span>
                </button>
              ))}
              {wikiSplit.wikis.map((w) => (
                <span key={w} className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">{w}</span>
              ))}
              <span className="text-gray-400 inline-flex items-center gap-1">
                <CornerDownLeft size={11} aria-hidden="true" /> 저장
                {(parsed.date || tab === 'today') && <> · Shift+Enter 인박스로</>}
              </span>
            </div>
          )}
        </div>
      </form>

      {tab === 'inbox' && <PlannerGuide />}

      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {tab === 'inbox' ? (
          <>
            {inboxLoading && openInbox.length === 0 ? (
              <p className="px-3 py-6 text-sm text-gray-400">불러오는 중…</p>
            ) : openInbox.length === 0 ? (
              <div className="px-3 py-8 text-center">
                <p className="text-sm font-medium text-gray-600 dark:text-gray-300">머릿속에 있는 걸 일단 적어두세요</p>
                <p className="mt-1 text-xs text-gray-400">언제 할지는 나중에 캘린더로 끌어서 정하면 돼요</p>
              </div>
            ) : (
              <ul className="space-y-0.5" aria-label="시간 미정 플랜">
                {openInbox.map((plan) => (
                  <li key={plan.id}>
                    <div
                      role="button"
                      tabIndex={0}
                      onPointerDown={(e) => { lastPointerType.current = e.pointerType; onItemPointerDown(e, plan) }}
                      onClick={() => {
                        // 데스크톱 마우스·펜 클릭은 pointer 흐름(onItemPointerDown)이 이미 처리했다.
                        // click 이벤트의 pointerType은 Safari에서 비어 있을 수 있어 직전 pointerdown 값으로 판정
                        if (variant === 'side' && lastPointerType.current !== 'touch') return
                        onSchedule(plan)
                      }}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSchedule(plan) } }}
                      className={cn(
                        'group flex items-center gap-2.5 px-2.5 min-h-11 rounded-lg text-sm text-gray-800 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800/60 select-none',
                        variant === 'side' && 'cursor-grab active:cursor-grabbing',
                        draggingId === plan.id && 'opacity-40 outline-1 outline-dashed outline-violet-400',
                      )}
                      title={variant === 'side' ? '캘린더로 끌어서 일정 정하기 · 클릭하면 시간 고르기' : undefined}
                    >
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); void completeInbox(plan) }}
                        aria-label={`'${plan.title}' 완료`}
                        className="w-5 h-5 flex-shrink-0 rounded border-2 border-gray-300 dark:border-gray-600 hover:border-violet-500 relative before:absolute before:-inset-2.5 before:content-['']"
                      />
                      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: plan.color }} aria-hidden="true" />
                      <PlanTitle title={plan.title} wikis={plan.wikiLinks} className="flex-1 min-w-0 truncate" />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <>
            {overdue.length > 0 && (
              <section aria-label="지난 미완료" className="mb-2">
                <h3 className="px-2.5 pt-1 pb-1 text-xs font-semibold text-amber-700 dark:text-amber-400">지난 미완료 {overdue.length}</h3>
                <ul className="space-y-0.5">
                  {overdue.map((plan) => (
                    <TodayRow key={plan.id} plan={plan} overdueLabel={fmtDay(plan.date!)} onToggle={toggleToday} onOpen={onEditPlan} onMoveToday={moveToToday} />
                  ))}
                </ul>
              </section>
            )}
            <section aria-label="오늘">
              <h3 className="px-2.5 pt-1 pb-1 text-xs font-semibold text-gray-500 dark:text-gray-400">
                오늘 · {format(new Date(), 'M월 d일')}
              </h3>
              {todayPlans.length === 0 ? (
                <p className="px-2.5 py-4 text-sm text-gray-400">오늘은 어떤 하루로 보낼까요? 위에 적거나 인박스에서 끌어오세요.</p>
              ) : (
                <ul className="space-y-0.5">
                  {todayPlans.map((plan) => (
                    <TodayRow key={plan.id} plan={plan} onToggle={toggleToday} onOpen={onEditPlan} />
                  ))}
                </ul>
              )}
            </section>
            {onCloseDay && (todayPlans.length > 0 || overdue.length > 0) && (
              <button
                type="button"
                onClick={onCloseDay}
                className="mt-4 mx-1 w-[calc(100%-0.5rem)] min-h-11 rounded-xl border border-violet-200 dark:border-violet-800 text-sm font-medium text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-950/30"
              >
                하루 마감하기
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function TodayRow({
  plan, overdueLabel, onToggle, onOpen, onMoveToday,
}: {
  plan: Plan
  overdueLabel?: string
  onToggle: (p: Plan) => void
  onOpen: (p: Plan) => void
  onMoveToday?: (p: Plan) => void
}) {
  return (
    <li
      className={cn(
        'flex items-center gap-2.5 px-2.5 min-h-11 rounded-lg text-sm',
        overdueLabel ? 'bg-amber-50/70 dark:bg-amber-950/20' : 'hover:bg-gray-50 dark:hover:bg-gray-800/60',
      )}
    >
      <button
        type="button"
        onClick={() => onToggle(plan)}
        aria-label={plan.isCompleted ? `'${plan.title}' 완료 취소` : `'${plan.title}' 완료`}
        aria-pressed={plan.isCompleted}
        className={cn(
          'w-5 h-5 flex-shrink-0 rounded border-2 flex items-center justify-center relative before:absolute before:-inset-2.5 before:content-[\'\']',
          plan.isCompleted ? 'bg-violet-600 border-violet-600 text-white' : overdueLabel ? 'border-amber-400' : 'border-gray-300 dark:border-gray-600',
        )}
      >
        {plan.isCompleted && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>}
      </button>
      <button
        type="button"
        onClick={() => onOpen(plan)}
        className={cn('flex-1 min-w-0 text-left truncate', plan.isCompleted ? 'line-through text-gray-400' : 'text-gray-800 dark:text-gray-200')}
      >
        <PlanTitle title={plan.title} wikis={plan.wikiLinks} chips={!plan.isCompleted} />
      </button>
      {overdueLabel ? (
        <>
          <span className="text-xs text-amber-700 dark:text-amber-400 tabular-nums">{overdueLabel}</span>
          {onMoveToday && (
            <button
              type="button"
              onClick={() => onMoveToday(plan)}
              className="text-xs px-2 min-h-8 rounded-md text-amber-800 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900/40 inline-flex items-center gap-0.5"
            >
              오늘로 <ArrowRight size={11} aria-hidden="true" />
            </button>
          )}
        </>
      ) : (
        !plan.isAllDay && plan.startTime && (
          <span className="text-xs text-gray-400 tabular-nums">{plan.startTime.slice(0, 5)}</span>
        )
      )}
    </li>
  )
}
