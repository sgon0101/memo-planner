'use client'

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
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/store/uiStore'

const NAV_ITEMS = [
  { href: '/home',     label: '홈',         icon: Home },
  { href: '/memo',     label: '메모장',     icon: FileText },
  { href: '/planner',  label: '플래너',     icon: CalendarDays },
  { href: '/graph',    label: '그래프 뷰',  icon: Network },
  { href: '/insights', label: 'AI 인사이트', icon: Sparkles },
  { href: '/settings', label: '설정',       icon: Settings },
]

interface SidebarProps {
  userEmail: string
}

export default function Sidebar({ userEmail }: SidebarProps) {
  const pathname = usePathname()
  const { sidebarOpen, toggleSidebar } = useUIStore()
  const initial = userEmail[0]?.toUpperCase() ?? '?'

  return (
    <aside
      className={cn(
        'hidden md:flex flex-col fixed left-0 top-0 h-full z-30',
        'bg-white dark:bg-gray-950',
        'border-r border-gray-100 dark:border-gray-800',
        'transition-all duration-200 ease-out',
        sidebarOpen ? 'w-56' : 'w-14',
      )}
    >
      {/* 로고 */}
      <div
        className={cn(
          'flex items-center h-14 px-3 border-b border-gray-100 dark:border-gray-800 flex-shrink-0',
          sidebarOpen ? 'gap-2.5' : 'justify-center',
        )}
      >
        <div className="flex-shrink-0 w-8 h-8 bg-violet-600 rounded-lg flex items-center justify-center shadow-sm">
          <NotebookPen size={15} className="text-white" />
        </div>
        {sidebarOpen && (
          <span className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate tracking-tight">
            메모 플래너
          </span>
        )}
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
              className={cn(
                'group relative flex items-center gap-3 rounded-lg text-sm font-medium',
                'transition-colors duration-150 ease-out',
                sidebarOpen ? 'px-3 py-2' : 'justify-center px-2 py-2',
                isActive
                  ? 'bg-violet-50 dark:bg-violet-950/50 text-violet-700 dark:text-violet-300'
                  : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800/60 hover:text-gray-800 dark:hover:text-gray-200',
              )}
            >
              {/* active 인디케이터 */}
              {isActive && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-violet-600 rounded-r-full" />
              )}
              <Icon
                size={17}
                className={cn(
                  'flex-shrink-0 transition-colors duration-150',
                  isActive ? 'text-violet-600 dark:text-violet-400' : 'text-gray-400 dark:text-gray-500 group-hover:text-gray-600 dark:group-hover:text-gray-300',
                )}
              />
              {sidebarOpen && <span className="truncate">{label}</span>}
            </Link>
          )
        })}
      </nav>

      {/* 프로필 */}
      <div
        className={cn(
          'p-2 border-t border-gray-100 dark:border-gray-800 flex-shrink-0',
          !sidebarOpen && 'flex justify-center',
        )}
      >
        {sidebarOpen ? (
          <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg">
            <div className="w-7 h-7 rounded-full bg-violet-100 dark:bg-violet-900/50 flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-semibold text-violet-700 dark:text-violet-300">{initial}</span>
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{userEmail}</p>
          </div>
        ) : (
          <div
            className="w-8 h-8 rounded-full bg-violet-100 dark:bg-violet-900/50 flex items-center justify-center cursor-default"
            title={userEmail}
          >
            <span className="text-xs font-semibold text-violet-700 dark:text-violet-300">{initial}</span>
          </div>
        )}
      </div>

      {/* 접기/펼치기 버튼 */}
      <button
        onClick={toggleSidebar}
        className={cn(
          'absolute -right-3 top-[4.5rem] w-6 h-6 cursor-pointer',
          'bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700',
          'rounded-full flex items-center justify-center',
          'shadow-sm hover:shadow-md transition-shadow duration-150',
          'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300',
        )}
        aria-label={sidebarOpen ? '사이드바 접기' : '사이드바 펼치기'}
      >
        {sidebarOpen
          ? <ChevronLeft size={11} />
          : <ChevronRight size={11} />
        }
      </button>
    </aside>
  )
}
