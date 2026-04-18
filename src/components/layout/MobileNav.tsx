'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, FileText, CalendarDays, Sparkles, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'

const NAV_ITEMS = [
  { href: '/home', label: '홈', icon: Home },
  { href: '/memo', label: '메모', icon: FileText },
  { href: '/planner', label: '플래너', icon: CalendarDays },
  { href: '/insights', label: '인사이트', icon: Sparkles },
  { href: '/settings', label: '설정', icon: Settings },
]

export default function MobileNav() {
  const pathname = usePathname()

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-800 flex items-center z-30">
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const isActive = pathname.startsWith(href)
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              'flex-1 flex flex-col items-center justify-center gap-1 py-2 text-xs font-medium transition-colors',
              isActive
                ? 'text-violet-600 dark:text-violet-400'
                : 'text-gray-500 dark:text-gray-400'
            )}
          >
            <Icon size={20} />
            <span>{label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
