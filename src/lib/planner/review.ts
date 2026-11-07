/**
 * 주간 돌아보기 집계 — 순수 함수 (2026-11 플래너 개선 ⑥).
 *
 * '계획 vs 실제'는 실제 소요 시간 기록이 아직 없어 넣지 않는다 — 없는 값을 계획값으로
 * 채우면 늘 '계획대로'가 되는 가짜 지표가 된다(Arch 실사용에서 확인한 함정).
 */

import { wikiNamesInTitle } from '@/lib/planner/titleTokens'

export interface ReviewPlan {
  title: string
  date: string | null
  startTime: string | null
  endTime: string | null
  isAllDay: boolean
  isCompleted: boolean
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
  const wiki = new Map<string, { min: number; count: number }>()
  for (const p of done) {
    for (const w of wikiNamesInTitle(p.title)) {
      const c = wiki.get(w) ?? { min: 0, count: 0 }
      c.min += minutes(p); c.count += 1
      wiki.set(w, c)
    }
  }
  return {
    total: plans.length,
    completed: done.length,
    plannedMin: done.reduce((s, p) => s + minutes(p), 0),
    wikiMinutes: [...wiki.entries()]
      .map(([name, c]) => ({ name, ...c }))
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
