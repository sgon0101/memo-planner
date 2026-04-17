'use client'

import { usePathname, useRouter } from 'next/navigation'
import { Menu, LogOut, Moon, Sun } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useUIStore } from '@/store/uiStore'

const PAGE_TITLES: Record<string, string> = {
  '/memo': '메모장',
  '/planner': '플래너',
  '/insights': 'AI 인사이트',
  '/settings': '설정',
}

interface HeaderProps {
  userEmail: string
}

export default function Header({ userEmail }: HeaderProps) {
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
    <header className="h-14 flex items-center justify-between px-4 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
      <div className="flex items-center gap-3">
        {/* 모바일 햄버거 */}
        <button
          className="md:hidden p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-400"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          aria-label="메뉴"
        >
          <Menu size={20} />
        </button>
        <h1 className="text-base font-semibold text-gray-900 dark:text-white">{title}</h1>
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={toggleDarkMode}
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400 transition-colors"
          aria-label="다크모드 전환"
        >
          {darkMode ? <Sun size={18} /> : <Moon size={18} />}
        </button>

        <button
          onClick={handleLogout}
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400 transition-colors"
          aria-label="로그아웃"
          title={`로그아웃 (${userEmail})`}
        >
          <LogOut size={18} />
        </button>
      </div>
    </header>
  )
}
