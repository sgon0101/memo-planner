'use client'

import { useState, Suspense } from 'react'
import dynamic from 'next/dynamic'
import { MessageCircle, TrendingUp, PieChart, Network, BookOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import { InsightsSkeleton } from '@/components/ui/Skeleton'

const AIChat     = dynamic(() => import('@/components/insights/AIChat'),     { loading: () => <InsightsSkeleton />, ssr: false })
const GapAnalysis = dynamic(() => import('@/components/insights/GapAnalysis'), { loading: () => <InsightsSkeleton />, ssr: false })
const BubbleChart = dynamic(() => import('@/components/insights/BubbleChart'), { loading: () => <InsightsSkeleton />, ssr: false })
const MindMap    = dynamic(() => import('@/components/insights/MindMap'),    { loading: () => <InsightsSkeleton />, ssr: false })
const RetroReport = dynamic(() => import('@/components/insights/RetroReport'), { loading: () => <InsightsSkeleton />, ssr: false })

const TABS = [
  { id: 'chat',    label: 'AI 대화',    icon: MessageCircle },
  { id: 'gap',     label: '갭 분석',    icon: TrendingUp },
  { id: 'bubble',  label: '관심사',     icon: PieChart },
  { id: 'mindmap', label: '마인드맵',   icon: Network },
  { id: 'retro',   label: '회고 리포트', icon: BookOpen },
] as const

type TabId = (typeof TABS)[number]['id']

export default function InsightsPage() {
  const [tab, setTab] = useState<TabId>('chat')

  return (
    <div className="flex flex-col h-full overflow-hidden bg-white dark:bg-gray-900">
      {/* 탭 헤더 */}
      <div className="flex-shrink-0 border-b border-gray-200 dark:border-gray-800 px-4 pt-2">
        <div className="flex gap-1 overflow-x-auto scrollbar-none">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cn(
                'flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-medium whitespace-nowrap border-b-2 transition-colors',
                tab === id
                  ? 'border-violet-600 text-violet-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
              )}
            >
              <Icon size={13} />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* 탭 콘텐츠 */}
      <div className="flex-1 overflow-y-auto">
        <Suspense fallback={<InsightsSkeleton />}>
          {tab === 'chat'    && <AIChat />}
          {tab === 'gap'     && <GapAnalysis />}
          {tab === 'bubble'  && <BubbleChart />}
          {tab === 'mindmap' && <MindMap />}
          {tab === 'retro'   && <RetroReport />}
        </Suspense>
      </div>
    </div>
  )
}
