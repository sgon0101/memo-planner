import { create } from 'zustand'
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

export const useFolderStore = create<FolderStore>((set) => ({
  folders: [],
  selectedFolderId: null,
  setFolders: (folders) => set({ folders }),
  addFolder: (folder) => set((s) => ({ folders: [...s.folders, folder] })),
  updateFolder: (id, patch) =>
    set((s) => ({ folders: s.folders.map((f) => (f.id === id ? { ...f, ...patch } : f)) })),
  deleteFolder: (id) =>
    set((s) => ({ folders: s.folders.filter((f) => f.id !== id) })),
  selectFolder: (id) => set({ selectedFolderId: id }),
}))
