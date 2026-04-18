import dynamic from 'next/dynamic'
import { CalendarSkeleton } from '@/components/ui/Skeleton'

const CalendarView = dynamic(() => import('@/components/planner/CalendarView'), {
  loading: () => <CalendarSkeleton />,
  ssr: false,
})

export default function PlannerPage() {
  return (
    <div className="h-full overflow-hidden">
      <CalendarView />
    </div>
  )
}
