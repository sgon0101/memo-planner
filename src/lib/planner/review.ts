/**
 * 주간 돌아보기 집계 — 순수 함수 (2026-11 플래너 개선 ⑥).
 *
 * '계획 vs 실제'는 실제 소요 시간 기록이 아직 없어 넣지 않는다 — 없는 값을 계획값으로
 * 채우면 늘 '계획대로'가 되는 가짜 지표가 된다(Arch 실사용에서 확인한 함정).
 */

import { planWikiNames } from '@/lib/planner/titleTokens'
import { wikiKey } from '@/lib/wiki/normalize'

export interface ReviewPlan {
  title: string
  date: string | null
  startTime: string | null
  endTime: string | null
  isAllDay: boolean
  isCompleted: boolean
  wikiLinks?: string[]
}

function minutes(p: ReviewPlan): number {
  if (p.isAllDay || !p.startTime || !p.endTime) return 0
  const [sh, sm] = p.startTime.slice(0, 5).split(':').map(Number)
  const [eh, em] = p.endTime.slice(0, 5).split(':').map(Number)
  return Math.max(0, eh * 60 + em - (sh * 60 + sm))
}

export const BANDS = [
  { label: '오전', from: 0, to: 12 },
  { label: '오후', from: 12, to: 18 },
  { label: '저녁', from: 18, to: 24 },
] as const

export interface WeekReview {
  total: number
  completed: number
  plannedMin: number
  wikiMinutes: { name: string; min: number; count: number }[]
}

/** 한 주(weekStart~weekEnd, 단일일 플랜) 요약 */
export function summarizeWeek(plans: ReviewPlan[]): WeekReview {
  const done = plans.filter((p) => p.isCompleted)
  // 키는 wikiKey — '행동 경제학'/'행동경제학'처럼 표기만 다른 위키를 한 줄로 (이름은 처음 본 표기)
  const wiki = new Map<string, { name: string; min: number; count: number }>()
  for (const p of done) {
    for (const w of planWikiNames(p)) {
      const k = wikiKey(w)
      const c = wiki.get(k) ?? { name: w, min: 0, count: 0 }
      c.min += minutes(p); c.count += 1
      wiki.set(k, c)
    }
  }
  return {
    total: plans.length,
    completed: done.length,
    plannedMin: done.reduce((s, p) => s + minutes(p), 0),
    wikiMinutes: [...wiki.values()]
      .map((c) => c)
      .sort((a, b) => b.min - a.min || b.count - a.count)
      .slice(0, 6),
  }
}

/** 요일(0=일) × 시간대 별 완료한 시간 지정 플랜 수 — 집중이 잘 되는 때 */
export function focusGrid(plans: ReviewPlan[]): { grid: number[][]; best: { dow: number; band: number } | null } {
  const grid = BANDS.map(() => Array.from({ length: 7 }, () => 0))
  for (const p of plans) {
    if (!p.isCompleted || p.isAllDay || !p.startTime || !p.date) continue
    const h = Number(p.startTime.slice(0, 2))
    const band = BANDS.findIndex((b) => h >= b.from && h < b.to)
    const dow = new Date(`${p.date}T12:00:00Z`).getUTCDay()
    if (band >= 0) grid[band][dow] += 1
  }
  let best: { dow: number; band: number } | null = null
  let max = 0
  grid.forEach((row, b) => row.forEach((v, d) => { if (v > max) { max = v; best = { dow: d, band: b } } }))
  return { grid, best }
}

/** 일지 제목 'YYYY-MM-DD 일지' → 날짜 집합 */
export function journalDays(titles: string[]): Set<string> {
  return new Set(titles.map((t) => /^(\d{4}-\d{2}-\d{2}) 일지$/.exec(t.trim())?.[1]).filter(Boolean) as string[])
}

/** 일지 본문에서 '한 줄 회고' 다음 줄 */
export function reflectionOf(contentText: string | null): string {
  if (!contentText) return ''
  const lines = contentText.split('\n').map((l) => l.trim())
  const i = lines.indexOf('한 줄 회고')
  return i >= 0 ? (lines[i + 1] ?? '') : ''
}

// ── 기간 (2026-11 돌아보기 2차) — 주 / 월 / 직접 지정 ─────────────────────────

export type ReviewMode = 'week' | 'month' | 'custom'

const DAY_MS = 86_400_000
function toDate(s: string): Date { return new Date(`${s}T12:00:00Z`) }
function toStr(d: Date): string { return d.toISOString().slice(0, 10) }
function addDaysStr(s: string, n: number): string { return toStr(new Date(toDate(s).getTime() + n * DAY_MS)) }
export function daysBetween(from: string, to: string): number { return Math.round((toDate(to).getTime() - toDate(from).getTime()) / DAY_MS) + 1 }

/** 기준일(anchor)이 들어 있는 주(일요일 시작) 또는 달 */
export function periodOf(mode: 'week' | 'month', anchor: string): { from: string; to: string } {
  if (mode === 'week') {
    const dow = toDate(anchor).getUTCDay()
    const from = addDaysStr(anchor, -dow)
    return { from, to: addDaysStr(from, 6) }
  }
  const [y, m] = anchor.split('-').map(Number)
  const from = `${y}-${String(m).padStart(2, '0')}-01`
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { from, to: `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}` }
}

/** 이전/다음 주·달의 기준일 */
export function shiftAnchor(mode: 'week' | 'month', anchor: string, dir: -1 | 1): string {
  if (mode === 'week') return addDaysStr(anchor, 7 * dir)
  const [y, m] = anchor.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + dir, 1))
  return toStr(d)
}

export const MAX_CUSTOM_DAYS = 366

/** 직접 지정 기간 검증 — 형식·순서·최대 1년 */
export function validCustomRange(from: string, to: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return '시작일과 종료일을 모두 골라주세요'
  if (Number.isNaN(toDate(from).getTime()) || Number.isNaN(toDate(to).getTime())) return '날짜를 다시 확인해주세요'
  if (from > to) return '시작일이 종료일보다 늦어요'
  if (daysBetween(from, to) > MAX_CUSTOM_DAYS) return '최대 1년까지 볼 수 있어요'
  return null
}

/**
 * '집중이 잘 되는 때'를 볼 구간 — 4주보다 짧은 기간은 표본이 너무 적어(예: 8주에 14개)
 * 기간 끝 기준 최근 8주로 넓힌다. 4주 이상이면 선택한 기간 그대로.
 */
export function focusWindow(from: string, to: string): { from: string; to: string; widened: boolean } {
  if (daysBetween(from, to) >= 28) return { from, to, widened: false }
  return { from: addDaysStr(to, -55), to, widened: true }
}

// ── 1년 스트릭 (기간 선택과 무관, 1월~12월 고정) ─────────────────────────────

export interface StreakCell { d: string; inYear: boolean; count: number; closed: boolean; future: boolean }

/**
 * 연도 히트맵 — 열 = 주(일요일 시작), 행 = 요일. 1/1이 든 주부터 12/31이 든 주까지.
 * monthCols: 각 달 1일이 들어 있는 열 번호 (월 라벨 위치).
 */
export function yearGrid(
  year: number,
  counts: ReadonlyMap<string, number>,
  closedDays: ReadonlySet<string>,
  today: string,
): { weeks: StreakCell[][]; monthCols: { month: number; col: number }[] } {
  const jan1 = `${year}-01-01`
  const start = addDaysStr(jan1, -toDate(jan1).getUTCDay())
  const dec31 = `${year}-12-31`
  const end = addDaysStr(dec31, 6 - toDate(dec31).getUTCDay())
  const weeks: StreakCell[][] = []
  const monthCols: { month: number; col: number }[] = []
  for (let d = start, i = 0; d <= end; d = addDaysStr(d, 1), i++) {
    const col = Math.floor(i / 7)
    if (!weeks[col]) weeks[col] = []
    const inYear = d.startsWith(`${year}-`)
    weeks[col].push({ d, inYear, count: inYear ? (counts.get(d) ?? 0) : 0, closed: inYear && closedDays.has(d), future: d > today })
    if (inYear && d.endsWith('-01')) monthCols.push({ month: Number(d.slice(5, 7)), col })
  }
  return { weeks, monthCols }
}

/** 히트맵 진하기 0~4 (0 = 없음) */
export function streakLevel(count: number): number {
  return count <= 0 ? 0 : Math.min(4, count)
}
