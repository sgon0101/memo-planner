/**
 * 인박스(시간 미정 플랜) 판정·빈 시간 계산 — 순수 함수 (2026-11 플래너 개선 1차).
 *
 * 스키마 변경 없이 정의한다: 날짜(date)도 기간(start_date)도 없고 반복도 아닌 플랜 = 인박스.
 * 기존 데이터에는 이 조합이 0건이었고(2026-11-07 확인), 캘린더 범위 쿼리
 * (date 범위 / start_date 범위 / 반복)는 이 행을 원래 가져오지 않는다.
 * ⚠️ date만 null인 플랜은 "기간 플랜"이다 — 인박스 판정은 반드시 이 함수로.
 */

import type { Plan } from '@/types'

type PlanLike = Pick<Plan, 'date' | 'startDate' | 'repeatType' | 'rruleStr'>

export function isInboxPlan(p: PlanLike): boolean {
  return !p.date && !p.startDate && !p.repeatType && !p.rruleStr
}

/** 인박스로 되돌릴 때 비울 필드 — 반복·알림·기간을 함께 정리해 '반쯤 남은' 상태를 막는다 */
export const INBOX_RESET_FIELDS: Partial<Plan> = {
  date: null,
  startDate: null,
  endDate: null,
  startTime: null,
  endTime: null,
  isAllDay: true,
  repeatType: null,
  repeatEndDate: null,
  rruleStr: null,
  notifyEnabled: false,
}

const DAY_START_MIN = 8 * 60   // 빈 시간 제안 범위: 08:00 ~ 22:00
const DAY_END_MIN = 22 * 60
const STEP_MIN = 30

function toMin(t: string): number {
  const [h, m] = t.slice(0, 5).split(':').map(Number)
  return h * 60 + m
}

export function minToTime(min: number): string {
  const safe = Math.max(0, Math.min(1440, min))
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`
}

/**
 * 하루의 빈 시간 시작점 제안 (최대 count개, 서로 90분 이상 간격).
 * busy: 그날의 시간 지정 플랜 [start,end). nowMin이 주어지면 그 이후(30분 올림)부터.
 */
export function suggestFreeSlots(
  busy: { startTime: string | null; endTime: string | null }[],
  durationMin: number,
  nowMin: number | null,
  count = 3,
): string[] {
  const intervals = busy
    .filter((b) => b.startTime && b.endTime)
    .map((b) => [toMin(b.startTime!), toMin(b.endTime!)] as const)
  const from = nowMin === null
    ? DAY_START_MIN
    : Math.max(DAY_START_MIN, Math.ceil((nowMin + 1) / STEP_MIN) * STEP_MIN)
  const out: number[] = []
  for (let s = from; s + durationMin <= DAY_END_MIN && out.length < count; s += STEP_MIN) {
    const e = s + durationMin
    if (intervals.some(([bs, be]) => s < be && e > bs)) continue
    if (out.length > 0 && s - out[out.length - 1] < 90) continue
    out.push(s)
  }
  return out.map(minToTime)
}
