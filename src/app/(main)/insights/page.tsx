'use client'

import { useState } from 'react'
import { MessageCircle, TrendingUp, PieChart, Network, BookOpen } from 'lucide-react'
import { cn } from '@/lib/utils'
import AIChat from '@/components/insights/AIChat'
import GapAnalysis from '@/components/insights/GapAnalysis'
import BubbleChart from '@/components/insights/BubbleChart'
import MindMap from '@/components/insights/MindMap'
import RetroReport from '@/components/insights/RetroReport'

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
        {tab === 'chat'    && <AIChat />}
        {tab === 'gap'     && <GapAnalysis />}
        {tab === 'bubble'  && <BubbleChart />}
        {tab === 'mindmap' && <MindMap />}
        {tab === 'retro'   && <RetroReport />}
      </div>
    </div>
  )
}
