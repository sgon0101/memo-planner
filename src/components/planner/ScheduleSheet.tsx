'use client'

/**
 * 인박스 항목 '언제 할까요?' 시트 (2026-11 플래너 개선 1차).
 * 모바일은 하단 시트, 데스크톱은 가운데 작은 대화상자. 드래그 대신 탭으로 일정을 정하는 길.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { addDays, format, nextMonday } from 'date-fns'
import { Pencil, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { usePlanner, useTodayListQuery } from '@/hooks/usePlanner'
import { suggestFreeSlots, minToTime } from '@/lib/planner/inbox'
import { reportSaveError } from '@/lib/ui/reportSaveError'
import PlanTitle from './PlanTitle'
import type { Plan } from '@/types'

interface ScheduleSheetProps {
  plan: Plan
  onClose: () => void
  /** 전체 편집 폼 열기 */
  onEdit: (plan: Plan) => void
}

const DURATION = 60

function addMin(t: string, min: number): string {
  const [h, m] = t.split(':').map(Number)
  return minToTime(Math.min(h * 60 + m + min, 24 * 60 - 1))
}

export default function ScheduleSheet({ plan, onClose, onEdit }: ScheduleSheetProps) {
  const now = new Date()
  const today = format(now, 'yyyy-MM-dd')
  const { today: todayPlans } = useTodayListQuery(today)
  const { schedulePlan, removePlanWithUndo } = usePlanner()
  const [busy, setBusy] = useState(false)
  const dateRef = useRef<HTMLInputElement>(null)
  const firstRef = useRef<HTMLButtonElement>(null)

  const slots = useMemo(
    () => suggestFreeSlots(
      todayPlans.filter((p) => !p.isAllDay),
      DURATION,
      now.getHours() * 60 + now.getMinutes(),
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 시트가 열린 시점 기준으로 고정
    [todayPlans],
  )
  const [picked, setPicked] = useState<string | null>(null)
  const chosen = picked ?? slots[0] ?? null

  // 포커스는 열릴 때 한 번만 (onClose는 매 렌더 새 함수 — deps에 두면 포커스가 계속 첫 버튼으로 튄다)
  useEffect(() => { firstRef.current?.focus() }, [])
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const busyRef = useRef(false)
  async function run(fn: () => Promise<unknown>) {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      await fn()
      onClose()
    } catch (err) {
      reportSaveError('일정을 정하지 못했어요.')(err)
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const at = (date: string, start: string | null) => run(() => schedulePlan(plan, start
    ? { date, startTime: start, endTime: addMin(start, DURATION), isAllDay: false }
    : { date, startTime: null, endTime: null, isAllDay: true }))

  function remove() {
    removePlanWithUndo(plan)
    onClose()
  }

  const chip = 'min-h-11 px-4 rounded-full border text-sm transition-colors'

  return (
    <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center" role="presentation">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="언제 할까요"
        className="relative w-full md:w-[420px] bg-white dark:bg-gray-900 rounded-t-2xl md:rounded-2xl shadow-2xl px-5 pt-3 pb-6 md:pb-5 max-h-[85vh] overflow-y-auto"
      >
        <div className="w-10 h-1 rounded-full bg-gray-300 dark:bg-gray-700 mx-auto mb-3 md:hidden" aria-hidden="true" />
        <div className="flex items-start gap-2">
          <h2 className="flex-1 text-lg font-bold leading-snug text-gray-900 dark:text-white">
            <PlanTitle title={plan.title} wikis={plan.wikiLinks} />
            <span className="block text-sm font-normal text-gray-500 dark:text-gray-400 mt-0.5">언제 할까요?</span>
          </h2>
          <button type="button" onClick={() => onEdit(plan)} aria-label="전체 편집" className="w-11 h-11 md:w-9 md:h-9 flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800">
            <Pencil size={16} />
          </button>
        </div>

        <h3 className="mt-5 mb-2 text-sm font-semibold text-gray-600 dark:text-gray-300">오늘 빈 시간 · 1시간</h3>
        {slots.length > 0 ? (
          <div className="grid grid-cols-3 gap-2">
            {slots.map((s, i) => (
              <button
                key={s}
                ref={i === 0 ? firstRef : undefined}
                type="button"
                aria-pressed={chosen === s}
                onClick={() => setPicked(s)}
                onDoubleClick={() => at(today, s)}
                className={cn(
                  'min-h-12 rounded-xl border text-base font-semibold tabular-nums transition-colors',
                  chosen === s
                    ? 'border-violet-500 bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300'
                    : 'border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-200 hover:border-violet-300',
                )}
              >
                {s}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-400">오늘은 남은 빈 시간이 없어요.</p>
        )}

        <h3 className="mt-5 mb-2 text-sm font-semibold text-gray-600 dark:text-gray-300">다른 날</h3>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={cn(chip, 'border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:border-violet-300')}
            onClick={() => at(format(addDays(now, 1), 'yyyy-MM-dd'), '09:00')}>내일 오전 9시</button>
          <button type="button" className={cn(chip, 'border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:border-violet-300')}
            onClick={() => at(format(nextMonday(now), 'yyyy-MM-dd'), null)}>다음 월요일</button>
          <label className={cn(chip, 'relative inline-flex items-center border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:border-violet-300 cursor-pointer')}>
            날짜 고르기
            <input
              ref={dateRef}
              type="date"
              min={today}
              aria-label="날짜 고르기"
              className="absolute inset-0 opacity-0 cursor-pointer"
              onChange={(e) => {
                // 키보드로 연도를 치는 중(예: 0002)엔 반쯤 입력된 값이 온다 — 오늘 이후 + 3년 안쪽만 받는다
                const v = e.target.value
                if (v && v >= today && v.slice(0, 4) <= String(now.getFullYear() + 3)) void at(v, null)
              }}
            />
          </label>
        </div>

        <div className="mt-6 flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => at(today, null)}
            className="flex-1 min-h-12 rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 text-sm font-medium"
          >
            오늘 할 일로 (시간 없이)
          </button>
          <button
            type="button"
            disabled={busy || !chosen}
            onClick={() => chosen && at(today, chosen)}
            className="flex-1 min-h-12 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white text-sm font-semibold"
          >
            {chosen ? `${chosen}에 넣기` : '빈 시간 없음'}
          </button>
        </div>

        <button
          type="button"
          onClick={remove}
          disabled={busy}
          className="mt-4 w-full min-h-11 inline-flex items-center justify-center gap-1.5 text-sm text-gray-500 hover:text-red-600 dark:text-gray-400"
        >
          <Trash2 size={14} aria-hidden="true" /> 삭제
        </button>
      </div>
    </div>
  )
}
