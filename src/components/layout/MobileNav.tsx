'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, FileText, CalendarDays, Network, Sparkles, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'

const NAV_ITEMS = [
  { href: '/home',     label: '홈',     icon: Home },
  { href: '/memo',     label: '메모',   icon: FileText },
  { href: '/planner',  label: '플래너', icon: CalendarDays },
  { href: '/graph',    label: '그래프', icon: Network },
  { href: '/insights', label: 'AI',    icon: Sparkles },
  { href: '/settings', label: '설정',   icon: Settings },
]

export default function MobileNav() {
  const pathname = usePathname()

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-white/95 dark:bg-gray-950/95 backdrop-blur border-t border-gray-100 dark:border-gray-800 flex items-center z-30"
      aria-label="모바일 네비게이션"
    >
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const isActive = pathname.startsWith(href)
        return (
          <Link
            key={href}
            href={href}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'flex-1 flex flex-col items-center justify-center gap-0.5 py-2 text-xs font-medium transition-colors duration-150 cursor-pointer',
              isActive
                ? 'text-violet-600 dark:text-violet-400'
                : 'text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300',
            )}
          >
            <div className="relative">
              <Icon size={19} />
              {isActive && (
                <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-violet-600 dark:bg-violet-400" />
              )}
            </div>
            <span className="mt-1">{label}</span>
          </Link>
        )
      })}
    </nav>
  )
}
