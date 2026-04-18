'use client'

import { cn } from '@/lib/utils'

interface TooltipData {
  x: number
  y: number
  label: string
  type: 'memo' | 'wiki' | 'tag'
  linkCount: number
}

export default function GraphTooltip({ data }: { data: TooltipData | null }) {
  if (!data) return null
  const typeLabel = data.type === 'memo' ? '메모' : data.type === 'wiki' ? '위키 허브' : '태그 허브'
  return (
    <div
      className="pointer-events-none fixed z-50 bg-gray-900 text-white text-xs rounded-lg px-3 py-2 shadow-lg max-w-[200px]"
      style={{ left: data.x + 12, top: data.y - 10 }}
    >
      <p className="font-medium truncate">{data.label}</p>
      <p className={cn('mt-0.5', data.type === 'wiki' ? 'text-emerald-400' : data.type === 'tag' ? 'text-blue-400' : 'text-violet-300')}>
        {typeLabel} · 연결 {data.linkCount}개
      </p>
      {data.type === 'memo' && (
        <p className="text-gray-400 mt-0.5">클릭해서 메모 열기</p>
      )}
    </div>
  )
}
