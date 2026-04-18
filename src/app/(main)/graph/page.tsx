import { Suspense } from 'react'
import GraphView from '@/components/graph/GraphView'

export default function GraphPage() {
  return (
    <div className="h-full">
      <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-gray-400">그래프 로딩 중...</div>}>
        <GraphView />
      </Suspense>
    </div>
  )
}
