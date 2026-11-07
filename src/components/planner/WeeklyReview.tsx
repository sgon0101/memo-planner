'use client'

/**
 * 주간 돌아보기 (2026-11 플래너 개선 ⑥). 판단 없이 보여준다 — 숫자 + 짧은 사실 문장만.
 * 집계는 lib/planner/review.ts (순수 함수, 단위 테스트).
 */

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useQuery } from '@tanstack/react-query'
import { addDays, addWeeks, format, parseISO, startOfWeek, subWeeks } from 'date-fns'
import { ko } from 'date-fns/locale'
import { ChevronLeft, ChevronRight, ArrowLeft } from 'lucide-react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { toPlan } from '@/hooks/usePlanner'
import { summarizeWeek, focusGrid, journalDays, reflectionOf, BANDS } from '@/lib/planner/review'
import { journalStreak } from '@/lib/planner/journal'

const DOW = ['일', '월', '화', '수', '목', '금', '토']
const SHADES = ['bg-gray-100 dark:bg-gray-800', 'bg-violet-200 dark:bg-violet-900', 'bg-violet-400 dark:bg-violet-700', 'bg-violet-700 dark:bg-violet-500']

function fmtMin(m: number): string {
  if (!m) return '0분'
  const h = Math.floor(m / 60), r = m % 60
  return h ? `${h}시간${r ? ` ${r}분` : ''}` : `${r}분`
}

export default function WeeklyReview() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 0 }))
  const ws = format(weekStart, 'yyyy-MM-dd')
  const we = format(addDays(weekStart, 6), 'yyyy-MM-dd')
  const focusFrom = format(subWeeks(weekStart, 7), 'yyyy-MM-dd') // 최근 8주
  const today = format(new Date(), 'yyyy-MM-dd')
  const isThisWeek = today >= ws && today <= we

  const { data, isLoading } = useQuery({
    queryKey: ['planner-review', ws],
    queryFn: async () => {
      const supabase = createClient()
      const [plansRes, journalsRes] = await Promise.all([
        // 단일일 플랜 (기간·반복·인박스 제외 — 하루 단위로 셀 수 있는 것만)
        supabase.from('plans').select('*').gte('date', focusFrom).lte('date', we)
          .is('repeat_type', null).is('rrule_str', null),
        supabase.from('memos').select('title, content_text').eq('is_deleted', false)
          .like('title', '____-__-__ 일지').order('title', { ascending: false }).limit(400),
      ])
      if (plansRes.error) throw plansRes.error
      return {
        plans: (plansRes.data ?? []).map(toPlan),
        journals: (journalsRes.data ?? []) as { title: string; content_text: string | null }[],
      }
    },
  })

  const view = useMemo(() => {
    const plans = data?.plans ?? []
    const week = plans.filter((p) => p.date! >= ws && p.date! <= we)
    const summary = summarizeWeek(week)
    const focus = focusGrid(plans)
    const titles = (data?.journals ?? []).map((j) => j.title)
    const days = journalDays(titles)
    const weekJournals = (data?.journals ?? []).filter((j) => {
      const d = j.title.slice(0, 10)
      return d >= ws && d <= we
    }).sort((a, b) => a.title.localeCompare(b.title))
    // 최근 20주 마감 히트맵 (열 = 주, 행 = 요일)
    const heatStart = subWeeks(weekStart, 19)
    const heat = Array.from({ length: 20 * 7 }, (_, i) => {
      const d = format(addDays(heatStart, Math.floor(i / 7) * 7 + (i % 7)), 'yyyy-MM-dd')
      return { d, on: days.has(d), future: d > today }
    })
    return { summary, focus, weekJournals, heat, streak: journalStreak(titles, today), closedThisWeek: weekJournals.length }
  }, [data, ws, we, weekStart, today])

  const { summary, focus } = view
  const maxFocus = Math.max(1, ...focus.grid.flat())
  const maxWiki = Math.max(1, ...summary.wikiMinutes.map((w) => w.min || w.count))

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-4">
      <header className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[240px]">
          <Link href="/planner" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 min-h-9">
            <ArrowLeft size={14} aria-hidden="true" /> 플래너
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
            {format(weekStart, 'M월 d일', { locale: ko })} – {format(addDays(weekStart, 6), 'M월 d일', { locale: ko })}
            <span className="text-gray-400 font-medium">{isThisWeek ? ', 이번 주' : ''}</span>
          </h1>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setWeekStart((d) => subWeeks(d, 1))} aria-label="이전 주" className="w-10 h-10 flex items-center justify-center rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800"><ChevronLeft size={16} /></button>
          <button type="button" onClick={() => setWeekStart((d) => addWeeks(d, 1))} disabled={isThisWeek} aria-label="다음 주" className="w-10 h-10 flex items-center justify-center rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-30"><ChevronRight size={16} /></button>
        </div>
      </header>

      {isLoading ? (
        <p className="py-12 text-center text-sm text-gray-400">불러오는 중…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="완료한 플랜" value={`${summary.completed}`} sub={summary.total ? `이 주 플랜 ${summary.total}개 중 ${Math.round((summary.completed / summary.total) * 100)}%` : '이 주 플랜이 없어요'} />
            <Stat label="완료한 일에 쓴 계획 시간" value={fmtMin(summary.plannedMin)} sub="시간을 정해둔 플랜 기준" />
            <Stat label="하루 마감" value={`${view.closedThisWeek}일`} sub={view.streak > 1 ? `지금 ${view.streak}일 연속` : '마감하면 일지가 쌓여요'} />
            <Stat label="엮인 위키" value={`${summary.wikiMinutes.length}개`} sub={summary.wikiMinutes[0] ? `[[${summary.wikiMinutes[0].name}]] 외` : '플랜에 위키를 달아보세요'} />
          </div>

          <div className="grid lg:grid-cols-2 gap-3">
            <Card title="집중이 잘 되는 때" caption="최근 8주, 완료한 시간 지정 플랜 기준">
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

            <Card title="위키별 시간" caption="이 주 완료한 플랜의 위키 기준">
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

          <Card title="마감한 날" caption="최근 20주">
            <div className="overflow-x-auto">
              <div className="grid grid-rows-7 grid-flow-col gap-[3px] w-max" role="img" aria-label={`최근 20주 중 ${view.heat.filter((h) => h.on).length}일 마감`}>
                {view.heat.map((h) => (
                  <span key={h.d} title={h.d} className={cn('w-3 h-3 rounded-sm', h.future ? 'bg-transparent' : h.on ? 'bg-violet-600' : 'bg-gray-100 dark:bg-gray-800')} />
                ))}
              </div>
            </div>
          </Card>

          <Card title="이번 주 일지">
            {view.weekJournals.length === 0 ? (
              <p className="text-sm text-gray-500">아직 일지가 없어요. 플래너의 ‘오늘’ 탭에서 하루를 마감하면 생겨요.</p>
            ) : (
              <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {view.weekJournals.map((j) => (
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
