import { cn } from '@/lib/utils'
import type { Plan } from '@/types'

interface RangeBarProps {
  plan: Plan
  startCol: number   // 0–6 within the week
  endCol: number     // 0–6 within the week
  slot: number       // vertical slot (0, 1, 2...)
  continuesLeft?: boolean  // 이전 주부터 이어짐 → 좌측 끝단 flat
  continuesRight?: boolean // 다음 주로 이어짐 → 우측 끝단 flat
  onClick?: () => void
}

export default function RangeBar({ plan, startCol, endCol, slot, continuesLeft, continuesRight, onClick }: RangeBarProps) {
  const span = endCol - startCol + 1
  return (
    <div
      onClick={(e) => { e.stopPropagation(); onClick?.() }}
      title={plan.title}
      className={cn(
        'absolute h-5 text-xs flex items-center px-1.5 truncate cursor-pointer transition-opacity hover:opacity-80 z-10',
        plan.isCompleted && 'opacity-50 line-through',
        // 주 경계에서 잘린 쪽은 flat — "다음/이전 주로 계속됨" 신호 (GCal 패턴).
        // 기존 startCol/endCol 기반 판정은 일요일 시작·토요일 종료 플랜을 이어짐으로 오판.
        'rounded',
        continuesLeft && 'rounded-l-none',
        continuesRight && 'rounded-r-none',
      )}
      style={{
        top: `${2 + slot * 22}px`,
        left: `calc(${startCol} / 7 * 100% + 1px)`,
        width: `calc(${span} / 7 * 100% - 2px)`,
        backgroundColor: plan.color + '28',
        // 시작 마커(좌측 3px 보더)는 실제 시작 주에서만 — 이어짐이면 flat 유지
        borderLeft: continuesLeft ? undefined : `3px solid ${plan.color}`,
        color: plan.color,
      }}
    >
      {plan.title}
    </div>
  )
}
