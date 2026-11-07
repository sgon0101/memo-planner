import { create } from 'zustand'

/**
 * 인박스 ↔ 캘린더 드래그 상태 (2026-11 플래너 개선).
 * - source 'inbox': InboxPanel 항목을 캘린더로 (일정 정하기)
 * - source 'calendar': 월뷰 칩·기간 바·종일 칩을 다른 날짜나 인박스로
 * WeekView/DayView/월뷰가 target을 읽어 놓일 자리를 그리고, InboxPanel은 target.kind==='inbox'나
 * overInbox(주/일 시간 블록 드래그 중 인박스 위)일 때 받을 준비 표시를 한다.
 */
export type DropTarget =
  | { kind: 'timed'; date: string; startMin: number }
  | { kind: 'allday'; date: string }
  | { kind: 'inbox' }

interface InboxDragState {
  /** 끌고 있는 플랜 (없으면 null) */
  planId: string | null
  title: string
  source: 'inbox' | 'calendar'
  x: number
  y: number
  target: DropTarget | null
  /** 놓았을 때 만들 길이(분) — 시간 지정 칸에 놓을 때 */
  durationMin: number
  /** 주/일뷰 시간 블록을 인박스 패널 위로 끌고 있는 중 (그 블록 드래그는 자체 상태라 표시만 공유) */
  overInbox: boolean
  start: (planId: string, title: string, x: number, y: number, source?: 'inbox' | 'calendar', durationMin?: number) => void
  move: (x: number, y: number, target: DropTarget | null) => void
  end: () => void
  setOverInbox: (v: boolean) => void
}

export const useInboxDragStore = create<InboxDragState>()((set) => ({
  planId: null,
  title: '',
  source: 'inbox',
  x: 0,
  y: 0,
  target: null,
  durationMin: 60,
  overInbox: false,
  start: (planId, title, x, y, source = 'inbox', durationMin = 60) => set({ planId, title, x, y, target: null, source, durationMin }),
  move: (x, y, target) => set({ x, y, target }),
  end: () => set({ planId: null, title: '', target: null, source: 'inbox', durationMin: 60 }),
  setOverInbox: (overInbox) => set((s) => (s.overInbox === overInbox ? s : { overInbox })),
}))
