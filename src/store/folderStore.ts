import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Folder } from '@/types'

interface FolderStore {
  folders: Folder[]
  selectedFolderId: string | null
  setFolders: (folders: Folder[]) => void
  addFolder: (folder: Folder) => void
  updateFolder: (id: string, patch: Partial<Folder>) => void
  deleteFolder: (id: string) => void
  selectFolder: (id: string | null) => void
}

export const useFolderStore = create<FolderStore>()(
  persist(
    (set) => ({
      folders: [],
      selectedFolderId: null,
      setFolders: (folders) => set({ folders }),
      addFolder: (folder) => set((s) => ({ folders: [...s.folders, folder] })),
      updateFolder: (id, patch) =>
        set((s) => ({ folders: s.folders.map((f) => (f.id === id ? { ...f, ...patch } : f)) })),
      deleteFolder: (id) =>
        set((s) => ({ folders: s.folders.filter((f) => f.id !== id) })),
      selectFolder: (id) => set({ selectedFolderId: id }),
    }),
    {
      name: 'memo-folder-selection',
      // selectedFolderId만 persist — folders는 React Query로 관리
      partialize: (state) => ({ selectedFolderId: state.selectedFolderId }),
    }
  )
)
