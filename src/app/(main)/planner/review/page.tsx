'use client'

import dynamic from 'next/dynamic'
import { CalendarSkeleton } from '@/components/ui/Skeleton'

const WeeklyReview = dynamic(() => import('@/components/planner/WeeklyReview'), {
  loading: () => <CalendarSkeleton />,
  ssr: false,
})

export default function PlannerReviewPage() {
  return (
    <div className="h-full overflow-y-auto">
      <WeeklyReview />
    </div>
  )
}
