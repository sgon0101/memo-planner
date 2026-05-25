import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type QuickCaptureMode = 'memo' | 'plan'

interface UIStore {
  sidebarOpen: boolean
  darkMode: boolean
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
  toggleDarkMode: () => void
  /** 빠른 캡처 모달 — 어디서든 메모/플랜을 즉시 작성 */
  quickCaptureOpen: boolean
  quickCaptureMode: QuickCaptureMode
  openQuickCapture: (mode?: QuickCaptureMode) => void
  closeQuickCapture: () => void
  toggleQuickCaptureMode: () => void
}

export const useUIStore = create<UIStore>()(
  persist(
    (set) => ({
      sidebarOpen: true,
      darkMode: false,
      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      toggleDarkMode: () => set((s) => ({ darkMode: !s.darkMode })),
      quickCaptureOpen: false,
      quickCaptureMode: 'memo',
      openQuickCapture: (mode) =>
        set({ quickCaptureOpen: true, ...(mode ? { quickCaptureMode: mode } : {}) }),
      closeQuickCapture: () => set({ quickCaptureOpen: false }),
      toggleQuickCaptureMode: () =>
        set((s) => ({ quickCaptureMode: s.quickCaptureMode === 'memo' ? 'plan' : 'memo' })),
    }),
    {
      name: 'memo-planner-ui',
      // quickCapture는 persist 제외 — 새로고침마다 닫힌 상태로 시작
      partialize: (state) => ({
        sidebarOpen: state.sidebarOpen,
        darkMode: state.darkMode,
      }),
    }
  )
)
