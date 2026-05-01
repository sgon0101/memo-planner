'use client'

import { useEffect } from 'react'
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
}

export default function Sidebar({ userEmail }: SidebarProps) {
  const pathname = usePathname()
  const { sidebarOpen, toggleSidebar, setSidebarOpen } = useUIStore()
  const initial = userEmail[0]?.toUpperCase() ?? '?'

  // 모바일 첫 방문 시 드로어 닫힌 상태로 시작 (persist 기본값 true 대응)
  useEffect(() => {
    if (isMobile()) setSidebarOpen(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ESC 키로 드로어 닫기
  useEffect(() => {
    if (!sidebarOpen) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setSidebarOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [sidebarOpen, setSidebarOpen])

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
        role="dialog"
        aria-modal="true"
        aria-label="네비게이션 메뉴"
        className={cn(
          'flex flex-col fixed left-0 top-0 h-full z-50',
          'bg-white dark:bg-gray-950',
          'border-r border-gray-100 dark:border-gray-800',
          'transition-all duration-200 ease-out',
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
            메모 플래너
          </span>
          {/* X 버튼 — 모바일 전용 */}
          <button
            onClick={handleClose}
            className="md:hidden p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors cursor-pointer"
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
                title={!sidebarOpen ? label : undefined}
                aria-current={isActive ? 'page' : undefined}
                onClick={() => { if (isMobile()) setSidebarOpen(false) }}
                className={cn(
                  'group relative flex items-center gap-3 rounded-lg text-sm font-medium',
                  'transition-colors duration-150 ease-out',
                  sidebarOpen ? 'px-3 py-2' : 'md:justify-center px-2 py-2',
                  isActive
                    ? 'bg-violet-50 dark:bg-violet-950/50 text-violet-700 dark:text-violet-300'
                    : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800/60 hover:text-gray-800 dark:hover:text-gray-200',
                )}
              >
                {isActive && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-violet-600 rounded-r-full" />
                )}
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
            <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{userEmail}</p>
          </div>
          {/* 아이콘만: 데스크톱 접힘 */}
          <div className={cn('hidden justify-center', !sidebarOpen && 'md:flex')}>
            <div
              className="w-8 h-8 rounded-full bg-violet-100 dark:bg-violet-900/50 flex items-center justify-center cursor-default"
              title={userEmail}
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
