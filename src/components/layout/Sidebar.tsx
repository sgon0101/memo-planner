'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  FileText,
  CalendarDays,
  Sparkles,
  Settings,
  ChevronLeft,
  ChevronRight,
  NotebookPen,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useUIStore } from '@/store/uiStore'

const NAV_ITEMS = [
  { href: '/memo', label: '메모장', icon: FileText },
  { href: '/planner', label: '플래너', icon: CalendarDays },
  { href: '/insights', label: 'AI 인사이트', icon: Sparkles },
  { href: '/settings', label: '설정', icon: Settings },
]

interface SidebarProps {
  userEmail: string
}

export default function Sidebar({ userEmail }: SidebarProps) {
  const pathname = usePathname()
  const { sidebarOpen, toggleSidebar } = useUIStore()

  return (
    <aside
      className={cn(
        'hidden md:flex flex-col fixed left-0 top-0 h-full bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 transition-all duration-200 z-30',
        sidebarOpen ? 'w-56' : 'w-14'
      )}
    >
      {/* 로고 */}
      <div className={cn('flex items-center h-14 px-3 border-b border-gray-200 dark:border-gray-800', sidebarOpen ? 'gap-2' : 'justify-center')}>
        <div className="flex-shrink-0 w-8 h-8 bg-violet-600 rounded-lg flex items-center justify-center">
          <NotebookPen size={16} className="text-white" />
        </div>
        {sidebarOpen && (
          <span className="text-sm font-semibold text-gray-900 dark:text-white truncate">
            메모 플래너
          </span>
        )}
      </div>

      {/* 네비게이션 */}
      <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const isActive = pathname.startsWith(href)
          return (
            <Link
              key={href}
              href={href}
              title={!sidebarOpen ? label : undefined}
              className={cn(
                'flex items-center gap-3 px-2.5 py-2 rounded-lg text-sm font-medium transition-colors',
                isActive
                  ? 'bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white',
                !sidebarOpen && 'justify-center px-2'
              )}
            >
              <Icon size={18} className="flex-shrink-0" />
              {sidebarOpen && <span>{label}</span>}
            </Link>
          )
        })}
      </nav>

      {/* 사용자 정보 */}
      <div className={cn('p-2 border-t border-gray-200 dark:border-gray-800', !sidebarOpen && 'flex justify-center')}>
        {sidebarOpen ? (
          <div className="px-2.5 py-2">
            <p className="text-xs text-gray-400 dark:text-gray-500 truncate">{userEmail}</p>
          </div>
        ) : (
          <div className="w-8 h-8 rounded-full bg-violet-100 dark:bg-violet-900/30 flex items-center justify-center">
            <span className="text-xs font-medium text-violet-700 dark:text-violet-300">
              {userEmail[0]?.toUpperCase()}
            </span>
          </div>
        )}
      </div>

      {/* 접기/펼치기 버튼 */}
      <button
        onClick={toggleSidebar}
        className="absolute -right-3 top-16 w-6 h-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-full flex items-center justify-center shadow-sm hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
        aria-label={sidebarOpen ? '사이드바 접기' : '사이드바 펼치기'}
      >
        {sidebarOpen ? (
          <ChevronLeft size={12} className="text-gray-500" />
        ) : (
          <ChevronRight size={12} className="text-gray-500" />
        )}
      </button>
    </aside>
  )
}
