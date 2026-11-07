'use client'

/**
 * 블록 빠른 편집 (2026-11 플래너 개선 — Arch 벤치마크 ②).
 *
 * 주·일뷰에서 블록을 누르면 큰 폼 대신 이 카드가 뜬다. 자주 하는 일(제목 고치기,
 * 길이 바꾸기, 메모, 완료, 인박스로, 삭제)은 여기서 끝내고, 나머지는 '전체 편집'으로.
 * 데스크톱은 누른 위치 옆에 붙고, 모바일은 하단 시트.
 * 반복 인스턴스는 시리즈 전체가 바뀌는 조작을 막고 완료·전체 편집만 허용한다.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { format, parseISO } from 'date-fns'
import { ko } from 'date-fns/locale'
import { X, Maximize2, Inbox, Trash2, FileText, Repeat } from 'lucide-react'
import { cn } from '@/lib/utils'
import { usePlanner } from '@/hooks/usePlanner'
import { useMemos } from '@/hooks/useMemos'
import { useMediaQuery } from '@/hooks/useMediaQuery'
import { minToTime } from '@/lib/planner/inbox'
import { timeToMinutes } from '@/lib/planner/dragHelpers'
import { pushPlanUndo } from '@/lib/planner/planUndo'
import { reportSaveError } from '@/lib/ui/reportSaveError'
import PlanTitle from './PlanTitle'
import type { Plan } from '@/types'

interface PlanQuickEditProps {
  plan: Plan
  /** 누른 위치 (데스크톱 배치용) */
  anchor: { x: number; y: number } | null
  onClose: () => void
  onFullEdit: (plan: Plan) => void
}

const DURATIONS = [30, 60, 90, 120]

function durLabel(m: number): string {
  if (m < 60) return `${m}분`
  return m % 60 === 0 ? `${m / 60}시간` : `${Math.floor(m / 60)}시간 ${m % 60}분`
}

export default function PlanQuickEdit({ plan, anchor, onClose, onFullEdit }: PlanQuickEditProps) {
  const router = useRouter()
  const isDesktop = useMediaQuery('(min-width: 768px)')
  const { editPlan, toggleComplete, toggleRecurringComplete, sendToInbox, removePlanWithUndo } = usePlanner()
  const { memos } = useMemos(undefined)
  const isInstance = !!plan.isRecurringInstance
  const isRecurring = isInstance || !!plan.rruleStr || !!plan.repeatType

  const [title, setTitle] = useState(plan.title)
  const [note, setNote] = useState(plan.description ?? '')
  // 닫기(바깥 클릭·Esc·X) 직전에 최신 입력값을 저장하기 위한 거울 — 언마운트 땐 onBlur가 안 불린다
  const titleRef = useRef(plan.title)
  const noteRef = useRef(plan.description ?? '')
  const [completed, setCompleted] = useState(plan.isCompleted)
  const cardRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  // 데스크톱: 누른 지점 오른쪽(공간이 없으면 왼쪽)에, 화면 안으로 끼워 넣기
  useLayoutEffect(() => {
    if (!isDesktop || !anchor || !cardRef.current) return
    const w = cardRef.current.offsetWidth
    const h = cardRef.current.offsetHeight
    const vw = window.innerWidth, vh = window.innerHeight
    let left = anchor.x + 16
    if (left + w > vw - 12) left = Math.max(12, anchor.x - w - 16)
    const top = Math.min(Math.max(12, anchor.y - 40), vh - h - 12)
    // 렌더 후 실제 크기를 재서 위치를 정하는 레이아웃 계산 (useLayoutEffect라 깜빡임 없음)
    setPos({ left, top })
  }, [isDesktop, anchor])

  const closingRef = useRef(false)
  async function flushAndClose() {
    if (closingRef.current) return
    closingRef.current = true
    await saveTitle()
    await saveNote()
    onClose()
  }
  /** 전체 편집 — 방금 고친 제목·메모를 저장하고, 그 값이 든 플랜을 폼에 넘긴다(옛 값으로 덮어쓰기 방지) */
  async function openFull() {
    await saveTitle()
    await saveNote()
    onFullEdit({ ...plan, title: savedTitle.current, description: savedNote.current, isCompleted: completed })
  }
  const flushRef = useRef(flushAndClose)
  useEffect(() => { flushRef.current = flushAndClose })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') void flushRef.current() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const id = plan.id
  const timed = !plan.isAllDay && !!plan.startTime && !!plan.endTime && !!plan.date && !plan.startDate
  const curDur = timed ? timeToMinutes(plan.endTime!.slice(0, 5)) - timeToMinutes(plan.startTime!.slice(0, 5)) : 0

  const savedTitle = useRef(plan.title)
  const savedNote = useRef(plan.description ?? '')
  async function saveTitle() {
    const t = titleRef.current.trim()
    if (isInstance || t === savedTitle.current) return
    if (!t) { setTitle(savedTitle.current); titleRef.current = savedTitle.current; return }
    try { await editPlan(id, { title: t }); savedTitle.current = t } catch (err) { reportSaveError('제목을 저장하지 못했어요.')(err) }
  }

  async function saveNote() {
    if (isInstance || noteRef.current === savedNote.current) return
    const v = noteRef.current
    try { await editPlan(id, { description: v }); savedNote.current = v } catch (err) { reportSaveError('메모를 저장하지 못했어요.')(err) }
  }

  async function setDuration(min: number) {
    if (!timed) return
    const start = timeToMinutes(plan.startTime!.slice(0, 5))
    const endTime = minToTime(Math.min(start + min, 24 * 60))
    const before = { endTime: plan.endTime }
    try {
      await editPlan(id, { endTime })
      pushPlanUndo(`'${plan.title}' 길이를 ${durLabel(min)}으로 바꿨어요`, () => editPlan(id, before))
      onClose()
    } catch (err) { reportSaveError('길이를 바꾸지 못했어요.')(err) }
  }

  async function makeAllDay() {
    const before = { isAllDay: plan.isAllDay, startTime: plan.startTime, endTime: plan.endTime }
    try {
      await editPlan(id, { isAllDay: true, startTime: null, endTime: null })
      pushPlanUndo(`'${plan.title}'을(를) 종일로 바꿨어요`, () => editPlan(id, before))
      onClose()
    } catch (err) { reportSaveError('종일로 바꾸지 못했어요.')(err) }
  }

  async function toggleDone() {
    try {
      if (isInstance && plan.originalPlanId && plan.date) {
        await toggleRecurringComplete(plan.originalPlanId, plan.date, completed)
      } else {
        await toggleComplete(id, completed)
      }
      setCompleted((v) => !v)
    } catch (err) { reportSaveError('완료 상태를 바꾸지 못했어요.')(err) }
  }

  async function toInbox() {
    try { await sendToInbox(plan); onClose() } catch (err) { reportSaveError('인박스로 보내지 못했어요.')(err) }
  }

  function remove() {
    removePlanWithUndo(plan)
    onClose()
  }

  const whenLabel = plan.startDate && plan.endDate
    ? `${format(parseISO(plan.startDate), 'M월 d일', { locale: ko })} – ${format(parseISO(plan.endDate), 'M월 d일', { locale: ko })}`
    : plan.date
      ? `${format(parseISO(plan.date), 'M월 d일 (eee)', { locale: ko })}${timed ? ` ${plan.startTime!.slice(0, 5)} – ${plan.endTime!.slice(0, 5)}` : ' 종일'}`
      : '날짜 미정'

  const linked = (plan.linkedMemoIds ?? [])
    .map((mid) => memos.find((m) => m.id === mid))
    .filter((m): m is NonNullable<typeof m> => !!m)

  const hasTokens = /\[\[[^\]]+\]\]|#\S/.test(title)

  const card = (
    <div
      ref={cardRef}
      role="dialog"
      aria-modal="true"
      aria-label="플랜 빠른 편집"
      className={cn(
        'bg-white dark:bg-gray-900 shadow-2xl border border-gray-200 dark:border-gray-800 flex flex-col',
        isDesktop ? 'fixed z-[61] w-[360px] rounded-2xl max-h-[80vh]' : 'relative w-full rounded-t-2xl max-h-[85vh]',
      )}
      style={isDesktop ? (pos ?? { left: '50%', top: '20%', transform: 'translateX(-50%)', visibility: anchor ? 'hidden' : undefined }) : undefined}
    >
      {!isDesktop && <div className="w-10 h-1 rounded-full bg-gray-300 dark:bg-gray-700 mx-auto mt-2.5" aria-hidden="true" />}
      <div className="flex items-center gap-1 px-3 pt-3">
        <span className="w-2.5 h-2.5 rounded-full ml-1" style={{ backgroundColor: plan.color }} aria-hidden="true" />
        <span className="text-xs text-gray-500 dark:text-gray-400 ml-1 truncate flex-1 flex items-center gap-1">
          {isRecurring && <Repeat size={11} aria-label="반복" />}
          {whenLabel}
        </span>
        <button type="button" onClick={openFull} aria-label="전체 편집" title="전체 편집" className="w-11 h-11 md:w-8 md:h-8 flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">
          <Maximize2 size={14} />
        </button>
        <button type="button" onClick={() => void flushAndClose()} aria-label="닫기" className="w-11 h-11 md:w-8 md:h-8 flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">
          <X size={15} />
        </button>
      </div>

      <div className="overflow-y-auto px-4 pb-4">
        <div className="flex items-start gap-3 mt-1">
          <button
            type="button"
            onClick={toggleDone}
            aria-pressed={completed}
            aria-label={completed ? '완료 취소' : '완료'}
            className={cn(
              'mt-1.5 w-5 h-5 flex-shrink-0 rounded border-[1.5px] flex items-center justify-center relative before:absolute before:-inset-3 before:content-[\'\']',
              completed ? 'bg-violet-600 border-violet-600 text-white' : 'border-gray-300 dark:border-gray-600',
            )}
          >
            {completed && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true"><path d="M5 12l5 5 9-10" /></svg>}
          </button>
          <div className="flex-1 min-w-0">
            <label htmlFor="quick-edit-title" className="sr-only">제목</label>
            <input
              id="quick-edit-title"
              type="search"
              autoComplete="off"
              data-form-type="other"
              data-1p-ignore=""
              value={title}
              readOnly={isInstance}
              onChange={(e) => { setTitle(e.target.value); titleRef.current = e.target.value }}
              onBlur={saveTitle}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur() } }}
              className={cn(
                'w-full bg-transparent text-lg font-bold text-gray-900 dark:text-white outline-none rounded-md px-1 -mx-1 focus:bg-gray-50 dark:focus:bg-gray-800 [&::-webkit-search-cancel-button]:hidden',
                completed && 'line-through text-gray-400',
              )}
            />
            {hasTokens && <PlanTitle title={title} className="block text-xs text-gray-500 mt-0.5" />}
          </div>
        </div>

        {timed && (
          <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="길이">
            {DURATIONS.map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={curDur === m}
                disabled={isInstance}
                onClick={() => setDuration(m)}
                className={cn(
                  'min-h-9 px-3 rounded-full border text-xs transition-colors disabled:opacity-40',
                  curDur === m
                    ? 'border-violet-400 bg-violet-50 text-violet-700 font-semibold dark:bg-violet-950/40 dark:text-violet-300'
                    : 'border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-violet-300',
                )}
              >
                {durLabel(m)}
              </button>
            ))}
            <button type="button" disabled={isInstance} onClick={makeAllDay} className="min-h-9 px-3 rounded-full border border-gray-200 dark:border-gray-700 text-xs text-gray-600 dark:text-gray-300 hover:border-violet-300 disabled:opacity-40">
              종일
            </button>
          </div>
        )}

        <label htmlFor="quick-edit-note" className="block mt-4 mb-1 text-xs text-gray-500 dark:text-gray-400">메모</label>
        <textarea
          id="quick-edit-note"
          rows={3}
          value={note}
          readOnly={isInstance}
          onChange={(e) => { setNote(e.target.value); noteRef.current = e.target.value }}
          onBlur={saveNote}
          placeholder={isInstance ? '반복 플랜은 전체 편집에서 고칠 수 있어요' : '준비물, 링크, 생각해둘 것…'}
          autoComplete="off"
          data-form-type="other"
          className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 outline-none focus:ring-2 focus:ring-violet-200 dark:focus:ring-violet-900 resize-none"
        />

        {linked.length > 0 && (
          <div className="mt-3 space-y-1.5">
            {linked.map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => router.push(`/memo/${m.id}`)}
                className="w-full flex items-center gap-2.5 px-3 min-h-11 rounded-lg border border-gray-200 dark:border-gray-700 text-left hover:border-violet-300"
              >
                <FileText size={15} className="text-violet-500 flex-shrink-0" aria-hidden="true" />
                <span className="flex-1 min-w-0 truncate text-sm text-gray-800 dark:text-gray-200">{m.title || '제목 없음'}</span>
                <span className="text-xs text-violet-600 dark:text-violet-400">열기</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-1 border-t border-gray-100 dark:border-gray-800 px-2 py-1.5">
        {!isRecurring && (
          <button type="button" onClick={toInbox} className="min-h-11 md:min-h-9 px-3 rounded-lg text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 inline-flex items-center gap-1.5">
            <Inbox size={14} aria-hidden="true" /> 인박스로
          </button>
        )}
        <div className="flex-1" />
        {!isRecurring && (
          <button type="button" onClick={remove} className="min-h-11 md:min-h-9 px-3 rounded-lg text-sm text-gray-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 inline-flex items-center gap-1.5">
            <Trash2 size={14} aria-hidden="true" /> 삭제
          </button>
        )}
        {isRecurring && (
          <button type="button" onClick={openFull} className="min-h-11 md:min-h-9 px-3 rounded-lg text-sm text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-950/30">
            반복 일정 편집
          </button>
        )}
      </div>
    </div>
  )

  return (
    <div className={cn('fixed inset-0 z-[60]', !isDesktop && 'flex items-end')}>
      <div
        className={cn('absolute inset-0', isDesktop ? 'bg-transparent' : 'bg-black/40')}
        onMouseDown={() => void flushAndClose()}
        aria-hidden="true"
      />
      {card}
    </div>
  )
}
