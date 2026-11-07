'use client'

/**
 * 돌아보기 (2026-11 플래너 개선 ⑥, 2차: 주·월·직접 지정 + 1년 스트릭).
 * 판단 없이 보여준다 — 숫자 + 짧은 사실 문장만. 집계는 lib/planner/review.ts (순수 함수, 단위 테스트).
 * 스트릭은 위 기간 선택과 무관하게 1월~12월 고정(연도만 넘김).
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { ko } from 'date-fns/locale'
import { ChevronLeft, ChevronRight, ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { toPlan } from '@/hooks/usePlanner'
import {
  summarizeWeek, focusGrid, journalDays, reflectionOf, BANDS,
  periodOf, shiftAnchor, validCustomRange, focusWindow, daysBetween,
  yearGrid, streakLevel, type ReviewMode,
} from '@/lib/planner/review'
import { journalStreak } from '@/lib/planner/journal'

const DOW = ['일', '월', '화', '수', '목', '금', '토']
const SHADES = ['bg-gray-100 dark:bg-gray-800', 'bg-violet-200 dark:bg-violet-900', 'bg-violet-400 dark:bg-violet-700', 'bg-violet-700 dark:bg-violet-500']
const STREAK_SHADES = [
  'bg-gray-100 dark:bg-gray-800',
  'bg-violet-200 dark:bg-violet-900',
  'bg-violet-300 dark:bg-violet-700',
  'bg-violet-500 dark:bg-violet-500',
  'bg-violet-700 dark:bg-violet-300',
]
const MODES: { id: ReviewMode; label: string }[] = [
  { id: 'week', label: '주' },
  { id: 'month', label: '월' },
  { id: 'custom', label: '직접 지정' },
]

function fmtMin(m: number): string {
  if (!m) return '0분'
  const h = Math.floor(m / 60), r = m % 60
  return h ? `${h}시간${r ? ` ${r}분` : ''}` : `${r}분`
}

export default function WeeklyReview() {
  const today = format(new Date(), 'yyyy-MM-dd')
  const [mode, setMode] = useState<ReviewMode>('week')
  const [anchor, setAnchor] = useState(today)
  // 직접 지정 — 입력 중 값(draft)과 적용된 값을 나눠, 반쯤 고른 날짜로 조회가 돌지 않게 한다
  const [draftFrom, setDraftFrom] = useState(() => periodOf('month', today).from)
  const [draftTo, setDraftTo] = useState(today)
  const [custom, setCustom] = useState<{ from: string; to: string }>({ from: periodOf('month', today).from, to: today })
  const customError = validCustomRange(draftFrom, draftTo)

  const { from, to } = mode === 'custom' ? custom : periodOf(mode, anchor)
  const isCurrent = mode !== 'custom' && today >= from && today <= to
  const focusRange = focusWindow(from, to)
  const fetchFrom = focusRange.from < from ? focusRange.from : from
  const scopeWord = mode === 'week' ? '이 주' : mode === 'month' ? '이 달' : '이 기간'

  const { data, isLoading } = useQuery({
    queryKey: ['planner-review', fetchFrom, to],
    queryFn: async () => {
      const supabase = createClient()
      const [plansRes, journalsRes, closesRes] = await Promise.all([
        // 단일일 플랜 (기간·반복·인박스 제외 — 하루 단위로 셀 수 있는 것만)
        supabase.from('plans').select('*').gte('date', fetchFrom).lte('date', to)
          .is('repeat_type', null).is('rrule_str', null),
        supabase.from('memos').select('title, content_text').eq('is_deleted', false)
          .like('title', '____-__-__ 일지').order('title', { ascending: false }).limit(800),
        // 하루 마감 기록(0024) — 일지 없이 건너뛴 날도 '마감한 날'
        supabase.from('plan_day_closes').select('day'),
      ])
      if (plansRes.error) throw plansRes.error
      if (journalsRes.error) throw journalsRes.error
      if (closesRes.error) throw closesRes.error
      return {
        plans: (plansRes.data ?? []).map(toPlan),
        journals: (journalsRes.data ?? []) as { title: string; content_text: string | null }[],
        closes: (closesRes.data ?? []).map((r) => r.day as string),
      }
    },
  })

  const view = useMemo(() => {
    const plans = data?.plans ?? []
    const inPeriod = plans.filter((p) => p.date! >= from && p.date! <= to)
    const summary = summarizeWeek(inPeriod)
    const focus = focusGrid(plans.filter((p) => p.date! >= focusRange.from && p.date! <= focusRange.to))
    const titles = (data?.journals ?? []).map((j) => j.title)
    // 마감한 날 = 일지가 있는 날 ∪ 마감 기록(건너뛰기 포함)
    const closedDays = new Set([...journalDays(titles), ...(data?.closes ?? [])])
    const closedInPeriod = [...closedDays].filter((d) => d >= from && d <= to).length
    const periodJournals = (data?.journals ?? []).filter((j) => {
      const d = j.title.slice(0, 10)
      return d >= from && d <= to
    }).sort((a, b) => b.title.localeCompare(a.title))
    return {
      summary, focus, periodJournals, closedDays, closedInPeriod,
      streak: journalStreak([...closedDays].map((d) => `${d} 일지`), today),
    }
  }, [data, from, to, focusRange.from, focusRange.to, today])

  const { summary, focus } = view
  const maxFocus = Math.max(1, ...focus.grid.flat())
  const maxWiki = Math.max(1, ...summary.wikiMinutes.map((w) => w.min || w.count))

  const heading = mode === 'month'
    ? format(parseISO(from), 'yyyy년 M월', { locale: ko })
    : `${format(parseISO(from), mode === 'custom' && from.slice(0, 4) !== to.slice(0, 4) ? 'yyyy년 M월 d일' : 'M월 d일', { locale: ko })} – ${format(parseISO(to), mode === 'custom' && from.slice(0, 4) !== to.slice(0, 4) ? 'yyyy년 M월 d일' : 'M월 d일', { locale: ko })}`

  function changeMode(next: ReviewMode) {
    if (next === mode) return
    // 주↔월 전환 시 보고 있던 기간의 시작일을 기준으로 — '지난주를 보다 월로 바꾸면 그 달'
    if (mode !== 'custom' && next !== 'custom') setAnchor(from)
    if (next === 'custom') { setDraftFrom(from); setDraftTo(to); setCustom({ from, to }) }
    setMode(next)
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-4">
      <header className="space-y-3">
        <Link href="/planner" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 min-h-9">
          <ArrowLeft size={14} aria-hidden="true" /> 플래너
        </Link>
        <div className="flex flex-wrap items-end gap-3">
          <h1 className="flex-1 min-w-[220px] text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
            {heading}
            <span className="text-gray-400 font-medium">{isCurrent ? (mode === 'week' ? ', 이번 주' : ', 이번 달') : ''}</span>
            {mode === 'custom' && <span className="ml-2 text-sm font-medium text-gray-400">{daysBetween(from, to)}일</span>}
          </h1>
          <div className="flex items-center gap-2">
            <div role="tablist" aria-label="돌아볼 기간" className="flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="tab"
                  aria-selected={mode === m.id}
                  onClick={() => changeMode(m.id)}
                  className={cn(
                    'px-3 min-h-10 text-sm font-medium transition-colors whitespace-nowrap',
                    mode === m.id ? 'bg-violet-600 text-white' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800',
                  )}
                >
                  {m.label}
                </button>
              ))}
            </div>
            {mode !== 'custom' && (
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => setAnchor((a) => shiftAnchor(mode, a, -1))} aria-label={mode === 'week' ? '이전 주' : '이전 달'} className="w-10 h-10 flex items-center justify-center rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800"><ChevronLeft size={16} /></button>
                <button type="button" onClick={() => setAnchor((a) => shiftAnchor(mode, a, 1))} disabled={isCurrent} aria-label={mode === 'week' ? '다음 주' : '다음 달'} className="w-10 h-10 flex items-center justify-center rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-30"><ChevronRight size={16} /></button>
              </div>
            )}
          </div>
        </div>

        {mode === 'custom' && (
          <form
            className="flex flex-wrap items-end gap-2 rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3"
            onSubmit={(e) => { e.preventDefault(); if (!customError) setCustom({ from: draftFrom, to: draftTo }) }}
          >
            <label className="flex flex-col gap-1 text-xs text-gray-500 dark:text-gray-400">
              시작일
              <input type="date" autoComplete="off" data-form-type="other" value={draftFrom} max={draftTo || undefined} onChange={(e) => setDraftFrom(e.target.value)}
                className="min-h-10 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2.5 text-sm text-gray-800 dark:text-gray-100" />
            </label>
            <span className="pb-2.5 text-gray-400" aria-hidden="true">–</span>
            <label className="flex flex-col gap-1 text-xs text-gray-500 dark:text-gray-400">
              종료일
              <input type="date" autoComplete="off" data-form-type="other" value={draftTo} min={draftFrom || undefined} onChange={(e) => setDraftTo(e.target.value)}
                className="min-h-10 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-2.5 text-sm text-gray-800 dark:text-gray-100" />
            </label>
            <button type="submit" disabled={!!customError || (draftFrom === custom.from && draftTo === custom.to)}
              className="min-h-10 px-4 rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white text-sm font-semibold">
              보기
            </button>
            {customError && <p role="alert" className="basis-full text-xs text-amber-700 dark:text-amber-400">{customError}</p>}
          </form>
        )}
      </header>

      {isLoading ? (
        <p className="py-12 text-center text-sm text-gray-400">불러오는 중…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="완료한 플랜" value={`${summary.completed}`} sub={summary.total ? `${scopeWord} 플랜 ${summary.total}개 중 ${Math.round((summary.completed / summary.total) * 100)}%` : `${scopeWord} 플랜이 없어요`} />
            <Stat label="완료한 일에 쓴 계획 시간" value={fmtMin(summary.plannedMin)} sub="시간을 정해둔 플랜 기준" />
            <Stat label="하루 마감" value={`${view.closedInPeriod}일`} sub={view.streak > 1 ? `지금 ${view.streak}일 연속` : '마감하면 일지가 쌓여요'} />
            <Stat label="엮인 위키" value={`${summary.wikiMinutes.length}개`} sub={summary.wikiMinutes[0] ? `[[${summary.wikiMinutes[0].name}]] 외` : '플랜에 위키를 달아보세요'} />
          </div>

          <div className="grid lg:grid-cols-2 gap-3">
            <Card title="집중이 잘 되는 때" caption={focusRange.widened ? '최근 8주, 완료한 시간 지정 플랜 기준' : `${scopeWord}, 완료한 시간 지정 플랜 기준`}>
              <p className="text-sm text-gray-600 dark:text-gray-300 mb-3">
                {focus.best
                  ? <>{DOW[focus.best.dow]}요일 <b className="text-gray-900 dark:text-white">{BANDS[focus.best.band].label}</b>에 끝낸 플랜이 가장 많아요</>
                  : '시간을 정해 끝낸 플랜이 쌓이면 보여드려요'}
              </p>
              <div className="grid grid-cols-[3rem_repeat(7,minmax(0,1fr))] gap-1 text-[11px] text-gray-500" role="table" aria-label="요일·시간대별 완료 수">
                <span />
                {DOW.map((d) => <span key={d} className="text-center" role="columnheader">{d}</span>)}
                {BANDS.map((b, bi) => (
                  <div key={b.label} className="contents" role="row">
                    <span className="flex items-center" role="rowheader">{b.label}</span>
                    {focus.grid[bi].map((v, d) => {
                      const level = v === 0 ? 0 : Math.min(3, Math.ceil((v / maxFocus) * 3))
                      return <span key={d} role="cell" aria-label={`${DOW[d]} ${b.label} ${v}개`} className={cn('h-6 rounded', SHADES[level])} />
                    })}
                  </div>
                ))}
              </div>
            </Card>

            <Card title="위키별 시간" caption={`${scopeWord} 완료한 플랜의 위키 기준`}>
              {summary.wikiMinutes.length === 0 ? (
                <p className="text-sm text-gray-500">플랜에 위키를 달면 완료한 시간이 위키별로 모여요.</p>
              ) : (
                <ul className="space-y-2.5">
                  {summary.wikiMinutes.map((w) => (
                    <li key={w.name} className="grid grid-cols-[7rem_minmax(0,1fr)_5rem] items-center gap-2 text-sm">
                      <span className="truncate text-emerald-700 dark:text-emerald-400">[[{w.name}]]</span>
                      <span className="h-2.5 rounded-full bg-gray-100 dark:bg-gray-800"><span className="block h-2.5 rounded-full bg-emerald-500" style={{ width: `${Math.max(6, ((w.min || w.count) / maxWiki) * 100)}%` }} /></span>
                      <span className="text-right tabular-nums text-gray-600 dark:text-gray-300">{w.min ? fmtMin(w.min) : `${w.count}개`}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <StreakCard today={today} closedDays={view.closedDays} />

          <Card title={mode === 'week' ? '이번 주 일지' : `${scopeWord} 일지`} caption={view.periodJournals.length > 12 ? `최근 12개 · 전체 ${view.periodJournals.length}개` : undefined}>
            {view.periodJournals.length === 0 ? (
              <p className="text-sm text-gray-500">아직 일지가 없어요. 플래너의 ‘오늘’ 탭에서 하루를 마감하면 생겨요.</p>
            ) : (
              <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {view.periodJournals.slice(0, 12).map((j) => (
                  <li key={j.title} className="rounded-xl border border-gray-200 dark:border-gray-700 p-3">
                    <p className="text-xs text-gray-500">{format(parseISO(j.title.slice(0, 10)), 'M/d (eee)', { locale: ko })}</p>
                    <p className="mt-1 text-sm font-medium text-gray-800 dark:text-gray-200 line-clamp-2">{reflectionOf(j.content_text) || '회고 없이 마감'}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  )
}

/**
 * 1년 스트릭 — 위 기간 선택과 무관하게 1월~12월 고정, 연도만 넘긴다.
 * 칸 색 = 그날 완료한 플랜 수(단일일), 테두리 = 하루 마감한 날(일지 저장 또는 건너뛰기, 0024).
 */
function StreakCard({ today, closedDays }: { today: string; closedDays: ReadonlySet<string> }) {
  const thisYear = Number(today.slice(0, 4))
  const [year, setYear] = useState(thisYear)
  const { data } = useQuery({
    queryKey: ['planner-review-year', year],
    queryFn: async () => {
      const { data, error } = await createClient().from('plans').select('date')
        .eq('is_completed', true).gte('date', `${year}-01-01`).lte('date', `${year}-12-31`)
      if (error) throw error
      const counts = new Map<string, number>()
      for (const r of data ?? []) { const d = r.date as string; counts.set(d, (counts.get(d) ?? 0) + 1) }
      return counts
    },
  })
  const grid = useMemo(() => yearGrid(year, data ?? new Map(), closedDays, today), [year, data, closedDays, today])
  const activeDays = grid.weeks.flat().filter((c) => c.inYear && c.count > 0).length
  const closedCount = grid.weeks.flat().filter((c) => c.closed).length

  // 모바일에서 가로 스크롤이 생기면 이번 달이 보이게
  const scrollRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = scrollRef.current
    if (!el || year !== thisYear) return
    const col = grid.monthCols.find((m) => m.month === Number(today.slice(5, 7)))?.col ?? 0
    el.scrollLeft = Math.max(0, col * 15 - el.clientWidth / 2)
  }, [year, thisYear, grid.monthCols, today])

  const colCount = grid.weeks.length
  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <h2 className="text-base font-bold text-gray-900 dark:text-white">스트릭</h2>
        <span className="text-xs text-gray-500 dark:text-gray-400">완료한 날 {activeDays}일 · 마감한 날 {closedCount}일</span>
        <div className="flex-1" />
        <button type="button" onClick={() => setYear((y) => y - 1)} aria-label="이전 해" className="w-9 h-9 flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"><ChevronLeft size={16} /></button>
        <span className="text-sm font-semibold tabular-nums text-gray-700 dark:text-gray-200">{year}</span>
        <button type="button" onClick={() => setYear((y) => y + 1)} disabled={year >= thisYear} aria-label="다음 해" className="w-9 h-9 flex items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30"><ChevronRight size={16} /></button>
      </div>

      <div ref={scrollRef} className="overflow-x-auto pb-1">
        <div className="w-max">
          {/* 월 라벨 — 각 달 1일이 든 주 위에 */}
          <div className="relative h-5 text-[11px] text-gray-500 dark:text-gray-400" style={{ width: colCount * 15 }}>
            {grid.monthCols.map((m) => (
              <span key={m.month} className="absolute top-0" style={{ left: m.col * 15 }}>{m.month}월</span>
            ))}
          </div>
          <div className="grid grid-rows-7 grid-flow-col gap-[3px]" role="img" aria-label={`${year}년 완료한 날 ${activeDays}일, 마감한 날 ${closedCount}일`}>
            {grid.weeks.flat().map((c) => (
              <span
                key={c.d}
                title={c.inYear ? `${c.d} · 완료 ${c.count}개${c.closed ? ' · 마감' : ''}` : undefined}
                className={cn(
                  'w-3 h-3 rounded-sm',
                  !c.inYear ? 'bg-transparent' : c.future ? 'bg-gray-50 dark:bg-gray-800/40' : STREAK_SHADES[streakLevel(c.count)],
                  c.closed && 'ring-1 ring-inset ring-violet-700 dark:ring-violet-200',
                  c.d === today && 'outline outline-1 outline-offset-1 outline-gray-400',
                )}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-end gap-x-4 gap-y-1 text-[11px] text-gray-500 dark:text-gray-400">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm ring-1 ring-inset ring-violet-700 dark:ring-violet-200" aria-hidden="true" /> 하루 마감
        </span>
        <span className="inline-flex items-center gap-1">
          적음
          {STREAK_SHADES.map((s, i) => <span key={i} className={cn('w-3 h-3 rounded-sm', s)} aria-hidden="true" />)}
          많음
        </span>
      </div>
    </section>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4">
      <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
      <p className="mt-1.5 text-2xl font-bold text-gray-900 dark:text-white">{value}</p>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 truncate">{sub}</p>
    </div>
  )
}

function Card({ title, caption, children }: { title: string; caption?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
        <h2 className="text-base font-bold text-gray-900 dark:text-white">{title}</h2>
        {caption && <span className="text-xs text-gray-500 dark:text-gray-400">{caption}</span>}
      </div>
      {children}
    </section>
  )
}
