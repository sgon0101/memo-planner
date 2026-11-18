'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Home, FileText, CalendarDays, Network, Sparkles, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'
import { TAB_PRELOAD } from '@/components/tabs/lazyTabs'

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
  const router = useRouter()
  // 누른 탭을 화면이 바뀌기 전에 바로 활성으로 표시 (2026-11-19).
  // 서버 응답을 기다리는 동안 아무 변화가 없어 '안 눌린 것처럼' 보이던 문제 — 주소가 바뀌면 원래대로 pathname을 따른다.
  // from: 누를 때의 주소 — 주소가 바뀌면 자동으로 무효(별도 정리 불필요)
  const [pending, setPending] = useState<{ href: string; from: string } | null>(null)
  const pendingHref = pending && pending.from === pathname ? pending.href : null

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-white/95 dark:bg-gray-950/95 backdrop-blur border-t border-gray-100 dark:border-gray-800 flex items-center z-30"
      aria-label="모바일 네비게이션"
    >
      {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
        const isActive = pendingHref ? pendingHref === href : pathname.startsWith(href)
        return (
          <Link
            key={href}
            href={href}
            prefetch={false}
            // 손가락이 닿는 순간 화면 정보 요청을 시작 — 손을 떼기까지 100ms 남짓을 번다(이미 받아 뒀으면 무시됨)
            onPointerDown={() => {
              try { router.prefetch(href) } catch { /* ignore */ }
              TAB_PRELOAD[href]?.().catch(() => {})
            }}
            onClick={(e) => {
              if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
              if (pathname !== href) setPending({ href, from: pathname })
            }}
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
