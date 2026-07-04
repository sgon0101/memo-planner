import { useSyncExternalStore } from 'react'
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

/**
 * hydration-safe darkMode 구독 (#418 방지).
 *
 * zustand persist는 클라이언트에서 동기 rehydrate되므로, darkMode를 렌더에
 * 직접 쓰면 SSR(기본값 false) ↔ 클라 첫 렌더(persist 값)가 어긋나
 * hydration mismatch가 난다. useSyncExternalStore의 서버 스냅샷을 false로
 * 고정하면 SSR과 첫 클라 렌더가 일치하고, 하이드레이션 직후 실값으로 재렌더된다.
 * darkMode를 렌더 출력에 사용할 때는 반드시 이 훅을 쓸 것 (effect에서는 무관).
 */
export function useDarkModeValue(): boolean {
  return useSyncExternalStore(
    useUIStore.subscribe,
    () => useUIStore.getState().darkMode,
    () => false,
  )
}
