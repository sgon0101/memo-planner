'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Home,
  FileText,
  CalendarDays,
  Sparkles,
  Settings,
  ChevronLeft,
  ChevronRight,
  NotebookPen,
  Network,
  X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/store/uiStore'
import { useSwipeGesture } from '@/hooks/useSwipeGesture'
import { useIsDesktop } from '@/hooks/useMediaQuery'

const NAV_ITEMS = [
  { href: '/home',     label: '홈',          icon: Home },
  { href: '/memo',     label: '메모장',      icon: FileText },
  { href: '/planner',  label: '플래너',      icon: CalendarDays },
  { href: '/graph',    label: '그래프 뷰',   icon: Network },
  { href: '/insights', label: 'AI 인사이트', icon: Sparkles },
  { href: '/settings', label: '설정',        icon: Settings },
]

const isMobile = () => typeof window !== 'undefined' && window.innerWidth < 768

interface SidebarProps {
  userEmail: string
  userName: string
}

export default function Sidebar({ userEmail, userName }: SidebarProps) {
  const pathname = usePathname()
  const { sidebarOpen, toggleSidebar, setSidebarOpen } = useUIStore()
  const initial = (userName || userEmail)[0]?.toUpperCase() ?? '?'

  // 접근성 역할 (2026-10-11 UX 2차)
  // - 데스크톱: 항상 보이는 일반 사이드바 → dialog 아님
  // - 모바일 열림: 모달 드로어 → dialog + 포커스 가두기 + 닫을 때 포커스 복귀
  // - 모바일 닫힘: 화면 밖 → inert로 탭 이동·스크린리더에서 제외
  const isDesktop = useIsDesktop()
  const isModalOpen = !isDesktop && sidebarOpen
  const isHiddenOffscreen = !isDesktop && !sidebarOpen
  const closeBtnRef = useRef<HTMLButtonElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)

  // 모바일 첫 방문 시 드로어 닫힌 상태로 시작 (persist 기본값 true 대응)
  useEffect(() => {
    if (isMobile()) setSidebarOpen(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ESC 키로 드로어 닫기 — 모바일 드로어일 때만 (데스크톱에서 ESC가 사이드바를 접지 않도록)
  useEffect(() => {
    if (!isModalOpen) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setSidebarOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [isModalOpen, setSidebarOpen])

  // 모바일 드로어 포커스 관리: 열리면 닫기 버튼으로, 닫히면 연 버튼(햄버거)으로 복귀
  useEffect(() => {
    if (!isModalOpen) return
    returnFocusRef.current = document.activeElement as HTMLElement | null
    closeBtnRef.current?.focus()
    return () => {
      const el = returnFocusRef.current
      // 링크 이동으로 닫힌 경우 원래 버튼이 사라졌을 수 있음 → 존재할 때만 복귀
      if (el && el.isConnected) el.focus()
      returnFocusRef.current = null
    }
  }, [isModalOpen])

  // 모바일 드로어 안에서 Tab 순환 (포커스가 뒤쪽 화면으로 새지 않게)
  function handleTrapKeyDown(e: React.KeyboardEvent<HTMLElement>) {
    if (!isModalOpen || e.key !== 'Tab') return
    const root = e.currentTarget
    const focusables = Array.from(
      root.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'),
    ).filter((el) => el.offsetParent !== null)
    if (focusables.length === 0) return
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }

  // 모바일 드로어 열릴 때 body 스크롤 잠금 (iOS Safari 대응)
  useEffect(() => {
    if (sidebarOpen && isMobile()) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [sidebarOpen])

  function handleClose() {
    setSidebarOpen(false)
  }

  // ── 모바일 swipe-left 닫기 ─────────────────────────────────────────
  // useSwipeGesture: PointerEvent + touch fallback 통합 파이프라인 (시각 피드백 dragX 포함)
  const { ref: asideRef, drag: dragX } = useSwipeGesture<HTMLElement>({
    axis: 'x',
    enabled: sidebarOpen,
    mobileOnly: true,
    dragClamp: [-240, 0],
    preventScroll: true, // 브라우저 가로 swipe(뒤로가기 등) 가로채기 차단
    onSwipeLeft: () => setSidebarOpen(false),
  })

  return (
    <>
      {/* 배경 딤 — 모바일에서 드로어 열릴 때만 표시 */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={handleClose}
          aria-hidden="true"
        />
      )}

      <aside
        ref={asideRef}
        id="app-sidebar"
        role={isModalOpen ? 'dialog' : undefined}
        aria-modal={isModalOpen ? true : undefined}
        aria-label="네비게이션 메뉴"
        inert={isHiddenOffscreen || undefined}
        onKeyDown={handleTrapKeyDown}
        style={{
          // 세로 스크롤 허용, 가로 스와이프는 우리가 처리 — 브라우저 기본 처리(pull-to-refresh 등) 차단
          touchAction: 'pan-y',
          ...(dragX < 0 ? { transform: `translateX(${dragX}px)`, transition: 'none' } : {}),
        }}
        className={cn(
          'flex flex-col fixed left-0 top-0 h-full z-50',
          'bg-white dark:bg-gray-950',
          'border-r border-gray-100 dark:border-gray-800',
          dragX < 0 ? '' : 'transition-all duration-200 ease-out',
          // 모바일: 고정 너비, transform으로 슬라이드 인/아웃
          'w-64 max-w-[85vw]',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full',
          // 데스크톱: 항상 표시, 너비만 토글
          'md:translate-x-0',
          sidebarOpen ? 'md:w-56' : 'md:w-14',
        )}
      >
        {/* 로고 */}
        <div
          className={cn(
            'flex items-center h-14 px-3 border-b border-gray-100 dark:border-gray-800 flex-shrink-0',
            sidebarOpen ? 'gap-2.5' : 'md:justify-center',
          )}
        >
          <div className="flex-shrink-0 w-8 h-8 bg-violet-600 rounded-lg flex items-center justify-center shadow-sm">
            <NotebookPen size={15} className="text-white" />
          </div>
          {/* 앱 이름: 모바일 드로어(항상 표시) + 데스크톱 펼침 */}
          <span
            className={cn(
              'flex-1 text-sm font-semibold text-gray-900 dark:text-gray-100 truncate tracking-tight',
              !sidebarOpen && 'md:hidden',
            )}
          >
            Weave
          </span>
          {/* X 버튼 — 모바일 전용 */}
          <button
            ref={closeBtnRef}
            onClick={handleClose}
            className="md:hidden -mr-1.5 w-11 h-11 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer"
            aria-label="메뉴 닫기"
          >
            <X size={16} />
          </button>
        </div>

        {/* 네비게이션 */}
        <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const isActive = pathname.startsWith(href)
            return (
              <Link
                key={href}
                href={href}
                prefetch={false}
                title={!sidebarOpen ? label : undefined}
                aria-current={isActive ? 'page' : undefined}
                onClick={() => { if (isMobile()) setSidebarOpen(false) }}
                className={cn(
                  'group relative flex items-center gap-3 rounded-lg text-sm font-medium',
                  'transition-colors duration-150 ease-out',
                  // 모바일 44px 터치 높이, 데스크톱은 기존 밀도 유지
                  sidebarOpen ? 'px-3 py-3 md:py-2' : 'md:justify-center px-2 py-3 md:py-2',
                  isActive
                    ? 'bg-violet-100/70 dark:bg-violet-950/50 text-violet-700 dark:text-violet-300 font-semibold'
                    : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800/60 hover:text-gray-800 dark:hover:text-gray-200',
                )}
              >
                <Icon
                  size={17}
                  className={cn(
                    'flex-shrink-0 transition-colors duration-150',
                    isActive
                      ? 'text-violet-600 dark:text-violet-400'
                      : 'text-gray-400 dark:text-gray-500 group-hover:text-gray-600 dark:group-hover:text-gray-300',
                  )}
                />
                {/* 레이블: 모바일 드로어(항상 표시) + 데스크톱 펼침 */}
                <span className={cn('truncate', !sidebarOpen && 'md:hidden')}>
                  {label}
                </span>
              </Link>
            )
          })}
        </nav>

        {/* 프로필 */}
        <div className="p-2 border-t border-gray-100 dark:border-gray-800 flex-shrink-0">
          {/* 풀 프로필: 모바일 드로어(항상) + 데스크톱 펼침 */}
          <div
            className={cn(
              'flex items-center gap-2.5 px-2 py-2 rounded-lg',
              !sidebarOpen && 'md:hidden',
            )}
          >
            <div className="w-7 h-7 rounded-full bg-violet-100 dark:bg-violet-900/50 flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-semibold text-violet-700 dark:text-violet-300">{initial}</span>
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">{userName}</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{userEmail}</p>
            </div>
          </div>
          {/* 아이콘만: 데스크톱 접힘 */}
          <div className={cn('hidden justify-center', !sidebarOpen && 'md:flex')}>
            <div
              className="w-8 h-8 rounded-full bg-violet-100 dark:bg-violet-900/50 flex items-center justify-center cursor-default"
              title={userName || userEmail}
            >
              <span className="text-xs font-semibold text-violet-700 dark:text-violet-300">{initial}</span>
            </div>
          </div>
        </div>

        {/* 접기/펼치기 버튼 — 데스크톱 전용 */}
        <button
          onClick={toggleSidebar}
          className={cn(
            'hidden md:flex absolute -right-3 top-[4.5rem] w-6 h-6 cursor-pointer',
            // 시각 24px 유지, 클릭 영역만 32px로
            "before:absolute before:-inset-1 before:content-['']",
            'bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700',
            'rounded-full items-center justify-center',
            'shadow-sm hover:shadow-md transition-shadow duration-150',
            'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300',
          )}
          aria-label={sidebarOpen ? '사이드바 접기' : '사이드바 펼치기'}
        >
          {sidebarOpen ? <ChevronLeft size={11} /> : <ChevronRight size={11} />}
        </button>
      </aside>
    </>
  )
}
