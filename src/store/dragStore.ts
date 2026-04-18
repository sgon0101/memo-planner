import { create } from 'zustand'

interface DragStore {
  draggingMemoId: string | null
  setDraggingMemo: (id: string | null) => void
}

export const useDragStore = create<DragStore>()((set) => ({
  draggingMemoId: null,
  setDraggingMemo: (id) => set({ draggingMemoId: id }),
}))
