import { create } from 'zustand'
import type { Memo } from '@/types'

interface ImageSwapNotice {
  mappings: Array<{ localBlobId: string; src: string; srcMd: string | null; srcSm: string | null }>
  ts: number
}

interface MemoStore {
  memos: Memo[]
  currentMemo: Memo | null
  /** PR-M1-C: 이미지 R2 swap 결과 — MemoEditor가 구독해 Tiptap node attrs 갱신 */
  lastImageSwap: ImageSwapNotice | null
  setMemos: (memos: Memo[]) => void
  appendMemos: (memos: Memo[]) => void
  setCurrentMemo: (memo: Memo | null) => void
  addMemo: (memo: Memo) => void
  updateMemo: (id: string, patch: Partial<Memo>) => void
  /** PR-M1-B: 오프라인 큐 flush 후 임시 ID → 진짜 ID 교체 */
  swapId: (oldId: string, newId: string, extraPatch?: Partial<Memo>) => void
  deleteMemo: (id: string) => void
  notifyImageSwap: (mappings: ImageSwapNotice['mappings']) => void
}

export const useMemoStore = create<MemoStore>((set) => ({
  memos: [],
  currentMemo: null,
  lastImageSwap: null,
  setMemos: (memos) => set({ memos }),
  appendMemos: (newMemos) =>
    set((s) => {
      const existingIds = new Set(s.memos.map((m) => m.id))
      const fresh = newMemos.filter((m) => !existingIds.has(m.id))
      return { memos: [...s.memos, ...fresh] }
    }),
  setCurrentMemo: (memo) => set({ currentMemo: memo }),
  addMemo: (memo) => set((s) => ({ memos: [memo, ...s.memos] })),
  updateMemo: (id, patch) =>
    set((s) => ({
      memos: s.memos.map((m) => (m.id === id ? { ...m, ...patch } : m)),
      currentMemo: s.currentMemo?.id === id ? { ...s.currentMemo, ...patch } : s.currentMemo,
    })),
  swapId: (oldId, newId, extraPatch) =>
    set((s) => ({
      memos: s.memos.map((m) =>
        m.id === oldId ? { ...m, id: newId, ...(extraPatch ?? {}) } : m
      ),
      currentMemo:
        s.currentMemo?.id === oldId
          ? { ...s.currentMemo, id: newId, ...(extraPatch ?? {}) }
          : s.currentMemo,
    })),
  deleteMemo: (id) =>
    set((s) => ({
      memos: s.memos.filter((m) => m.id !== id),
      currentMemo: s.currentMemo?.id === id ? null : s.currentMemo,
    })),
  notifyImageSwap: (mappings) => set({ lastImageSwap: { mappings, ts: Date.now() } }),
}))
