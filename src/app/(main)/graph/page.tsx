import { Suspense } from 'react'
import dynamic from 'next/dynamic'
import { GraphSkeleton } from '@/components/ui/Skeleton'

const GraphView = dynamic(() => import('@/components/graph/GraphView'), {
  loading: () => <GraphSkeleton />,
  ssr: false,
})

export default function GraphPage() {
  return (
    <div className="h-full">
      <Suspense fallback={<GraphSkeleton />}>
        <GraphView />
      </Suspense>
    </div>
  )
}
