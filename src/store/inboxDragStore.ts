import { create } from 'zustand'

/**
 * 인박스 → 캘린더 드래그 상태 (2026-11 플래너 개선 1차).
 * InboxPanel이 쓰고, WeekView/DayView/월뷰가 target을 읽어 놓일 자리 미리보기를 그린다.
 */
export type DropTarget =
  | { kind: 'timed'; date: string; startMin: number }
  | { kind: 'allday'; date: string }

interface InboxDragState {
  /** 끌고 있는 인박스 플랜 (없으면 null) */
  planId: string | null
  title: string
  x: number
  y: number
  target: DropTarget | null
  /** 놓았을 때 만들 길이(분) — 시간 지정 칸에 놓을 때 */
  durationMin: number
  start: (planId: string, title: string, x: number, y: number) => void
  move: (x: number, y: number, target: DropTarget | null) => void
  end: () => void
}

export const useInboxDragStore = create<InboxDragState>()((set) => ({
  planId: null,
  title: '',
  x: 0,
  y: 0,
  target: null,
  durationMin: 60,
  start: (planId, title, x, y) => set({ planId, title, x, y, target: null }),
  move: (x, y, target) => set({ x, y, target }),
  end: () => set({ planId: null, title: '', target: null }),
}))
