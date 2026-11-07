/**
 * 화면 좌표 → 캘린더 놓을 자리 (브라우저 전용).
 *
 * 캘린더 쪽은 DOM에 표식만 단다:
 *   data-drop-kind="timed"  data-drop-day="YYYY-MM-DD"  — 0시~24시 전체 높이 컬럼 (top = 00:00)
 *   data-drop-kind="allday" data-drop-day="YYYY-MM-DD"  — 종일 레인 칸 / 월뷰 날짜 칸
 * 컬럼의 getBoundingClientRect()는 스크롤을 반영하므로 별도 보정이 필요 없다.
 */

import { HOUR_H, snapMinutes } from '@/lib/planner/dragHelpers'
import type { DropTarget } from '@/store/inboxDragStore'

export function resolveDropTarget(x: number, y: number, durationMin: number): DropTarget | null {
  if (typeof document === 'undefined') return null
  for (const el of document.elementsFromPoint(x, y)) {
    const host = (el as HTMLElement).closest?.('[data-drop-kind]') as HTMLElement | null
    if (!host) continue
    const kind = host.dataset.dropKind
    const date = host.dataset.dropDay
    if (!date) continue
    if (kind === 'allday') return { kind: 'allday', date }
    if (kind === 'timed') {
      const rect = host.getBoundingClientRect()
      const raw = ((y - rect.top) / HOUR_H) * 60 - durationMin / 4 // 커서가 블록 위쪽 1/4쯤을 잡은 느낌
      const startMin = Math.max(0, Math.min(24 * 60 - durationMin, snapMinutes(raw)))
      return { kind: 'timed', date, startMin }
    }
  }
  return null
}
