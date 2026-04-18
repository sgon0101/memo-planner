import { cn } from '@/lib/utils'
import type { Plan } from '@/types'

interface RangeBarProps {
  plan: Plan
  startCol: number   // 0–6 within the week
  endCol: number     // 0–6 within the week
  slot: number       // vertical slot (0, 1, 2...)
  onClick?: () => void
}

export default function RangeBar({ plan, startCol, endCol, slot, onClick }: RangeBarProps) {
  const span = endCol - startCol + 1
  return (
    <div
      onClick={(e) => { e.stopPropagation(); onClick?.() }}
      title={plan.title}
      className={cn(
        'absolute h-5 text-xs flex items-center px-1.5 truncate cursor-pointer transition-opacity hover:opacity-80 z-10',
        plan.isCompleted && 'opacity-50 line-through',
        startCol > 0 ? 'rounded' : 'rounded-r',
        endCol < 6 ? '' : 'rounded-r',
      )}
      style={{
        top: `${2 + slot * 22}px`,
        left: `calc(${startCol} / 7 * 100% + 1px)`,
        width: `calc(${span} / 7 * 100% - 2px)`,
        backgroundColor: plan.color + '28',
        borderLeft: `3px solid ${plan.color}`,
        color: plan.color,
      }}
    >
      {plan.title}
    </div>
  )
}
