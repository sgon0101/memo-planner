'use client'

import { usePathname, useRouter } from 'next/navigation'
import { Menu, LogOut, Moon, Sun } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useUIStore } from '@/store/uiStore'

const PAGE_TITLES: Record<string, string> = {
  '/home':     '홈',
  '/memo':     '메모장',
  '/planner':  '플래너',
  '/insights': 'AI 인사이트',
  '/graph':    '그래프 뷰',
  '/settings': '설정',
}

interface HeaderProps {
  userEmail: string
}

export default function Header({ userEmail: _userEmail }: HeaderProps) {
  const pathname = usePathname()
  const router = useRouter()
  const { darkMode, toggleDarkMode, setSidebarOpen, sidebarOpen } = useUIStore()

  const title = Object.entries(PAGE_TITLES).find(([key]) => pathname.startsWith(key))?.[1] ?? ''

  async function handleLogout() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <header className="h-14 flex items-center justify-between px-4 bg-white dark:bg-gray-950 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
      <div className="flex items-center gap-3">
        {/* 모바일 햄버거 */}
        <button
          className="md:hidden w-9 h-9 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400 transition-colors duration-150 cursor-pointer"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          aria-label="메뉴"
        >
          <Menu size={18} />
        </button>
        {title && (
          <h1 className="text-sm font-semibold text-gray-700 dark:text-gray-300 tracking-tight">{title}</h1>
        )}
      </div>

      <div className="flex items-center gap-0.5">
        <button
          onClick={toggleDarkMode}
          className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors duration-150 cursor-pointer"
          aria-label="다크모드 전환"
        >
          {darkMode ? <Sun size={16} /> : <Moon size={16} />}
        </button>

        <button
          onClick={handleLogout}
          className="w-9 h-9 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 transition-colors duration-150 cursor-pointer"
          aria-label="로그아웃"
        >
          <LogOut size={16} />
        </button>
      </div>
    </header>
  )
}
