/**
 * 캘린더 플랜 블록 드래그/리사이즈 헬퍼 (#7).
 */

export const SNAP_MINUTES = 15
export const HOUR_H = 60  // px per hour — WeekView/DayView와 동일해야 함

export function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

export function minutesToTime(min: number): string {
  // 0~1440 (자정 = 1440)로 clamp는 호출 측에서
  const safe = Math.max(0, Math.min(1440, min))
  const h = Math.floor(safe / 60)
  const m = safe % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function snapMinutes(min: number): number {
  return Math.round(min / SNAP_MINUTES) * SNAP_MINUTES
}

/** 'YYYY-MM-DD' + N일 → 'YYYY-MM-DD' (UTC noon 기준, DST 안전) */
export function addDaysToISO(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** mouse/touch가 그리드 안에서 움직인 거리(px)로부터 시간 이동(분) 계산 */
export function pxToMinutes(deltaPx: number): number {
  return Math.round((deltaPx / HOUR_H) * 60)
}

/** drag로 인식하기 위한 최소 이동 거리(px) */
export const DRAG_THRESHOLD_PX = 5

/** 모바일 long-press 시간(ms) — 이 시간만큼 손가락이 멈춰있어야 drag 시작 */
export const LONG_PRESS_MS = 450
