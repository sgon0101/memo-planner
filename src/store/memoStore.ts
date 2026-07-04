import { create } from 'zustand'

// ─────────────────────────────────────────────────────────────
// 상태 이중화 정리 (2026-07-04): 메모 서버 데이터는 React Query 단일 출처.
// 기존 memos[]/currentMemo 거울과 그 액션들(setMemos/addMemo/updateMemo/
// deleteMemo/swapId/appendMemos/setCurrentMemo)은 제거됐다.
// 이 스토어에는 순수 UI 신호만 남는다.
// ─────────────────────────────────────────────────────────────

interface ImageSwapNotice {
  mappings: Array<{ localBlobId: string; src: string; srcMd: string | null; srcSm: string | null }>
  ts: number
}

interface MemoStore {
  /** PR-M1-C: 이미지 R2 swap 결과 — MemoEditor가 구독해 Tiptap node attrs 갱신 */
  lastImageSwap: ImageSwapNotice | null
  notifyImageSwap: (mappings: ImageSwapNotice['mappings']) => void
}

export const useMemoStore = create<MemoStore>((set) => ({
  lastImageSwap: null,
  notifyImageSwap: (mappings) => set({ lastImageSwap: { mappings, ts: Date.now() } }),
}))
