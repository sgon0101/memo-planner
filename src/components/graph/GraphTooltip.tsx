'use client'

import { GRAPH_COLORS } from '@/lib/graph/colors'

interface TooltipData {
  x: number
  y: number
  label: string
  type: 'memo' | 'wiki' | 'tag'
  linkCount: number
}

// 툴팁 타입 라벨 색 — 그래프 노드 색(lib/graph/colors.ts 단일 출처)과 일치.
// 메모는 어두운 툴팁 배경(gray-900) 위 가독성을 위해 밝은 톤(memoSome) 사용.
const TYPE_COLOR: Record<TooltipData['type'], string> = {
  wiki: GRAPH_COLORS.wiki,
  tag: GRAPH_COLORS.tag,
  memo: GRAPH_COLORS.memoSome,
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
      <p className="mt-0.5" style={{ color: TYPE_COLOR[data.type] }}>
        {typeLabel} · 연결 {data.linkCount}개
      </p>
      {data.type === 'memo' && (
        <p className="text-gray-400 mt-0.5">클릭해서 메모 열기</p>
      )}
    </div>
  )
}
