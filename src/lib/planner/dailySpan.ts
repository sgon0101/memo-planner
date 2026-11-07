import type { Plan } from '@/types'
import { buildRRule, parseRRule, defaultRecurrence } from '@/lib/planner/rrulePresets'

/**
 * 기간 플랜의 '매일 하루씩' 표시 (2026-11).
 *
 * 저장은 기존 반복 구조를 그대로 쓴다: date = 시작일, 매일 반복, UNTIL = 종료일.
 * 그래서 주·일 보기에 날마다 하루 플랜으로 나오고, 날마다 따로 완료할 수 있다.
 * 폼에서는 '기간 + 매일 하루씩'으로 보여 날짜를 위에서 한 번만 정한다.
 */

/** 시작일~종료일 매일 반복하는 RRULE */
export function dailySpanRRule(start: string, end: string): string {
  return buildRRule({ ...defaultRecurrence(), preset: 'daily', endMode: 'until', endUntil: end }, start) as string
}

/** 저장된 플랜이 '기간 · 매일 하루씩'(매일 반복 + 종료일)이면 시작~종료 */
export function readDailySpan(p: Pick<Plan, 'date' | 'startDate' | 'rruleStr'>): { start: string; end: string } | null {
  if (!p.date || p.startDate || !p.rruleStr) return null
  const r = parseRRule(p.rruleStr, p.date)
  if (r.preset !== 'daily' || r.endMode !== 'until' || !r.endUntil || r.endUntil < p.date) return null
  return { start: p.date, end: r.endUntil }
}

/** 반복 인스턴스(가상 행 `원본id_날짜`)를 편집할 때는 원본 시리즈로 바꾼다 — 가상 id로 저장하면 서버가 400을 낸다 */
export function seriesOf(p: Plan): Plan {
  if (!p.isRecurringInstance || !p.originalPlanId) return p
  return {
    ...p,
    id: p.originalPlanId,
    date: p.seriesDate ?? p.date,
    isRecurringInstance: false,
    originalPlanId: undefined,
    seriesDate: undefined,
  }
}

/** 시작일~종료일 포함 일수 (잘못된 범위는 1) */
export function daysInclusive(start: string, end: string): number {
  const ms = Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)
  return Number.isFinite(ms) && ms >= 0 ? Math.round(ms / 86_400_000) + 1 : 1
}
