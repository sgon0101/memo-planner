'use client'

import { cn } from '@/lib/utils'
import { daysInclusive } from '@/lib/planner/dailySpan'

/**
 * 기간 플랜의 표시 방식 — 한 덩어리(막대) / 매일 하루씩(날마다 하루 플랜).
 * 기간은 날짜를 위에서 한 번만 정하고, 반복 칩 대신 이걸로 고른다 (PlanFormModal·QuickCaptureModal 공용).
 */
export default function RangeDisplayChips({ daily, onChange, startDate, endDate, className }: {
  daily: boolean
  onChange: (daily: boolean) => void
  startDate: string
  endDate: string
  className?: string
}) {
  return (
    <div className={className}>
      <p className="text-xs text-gray-500 mb-1">표시 방식</p>
      <div role="group" aria-label="기간 표시 방식" className="flex gap-1.5">
        {([[false, '한 덩어리'], [true, '매일 하루씩']] as const).map(([v, label]) => (
          <button
            key={label}
            type="button"
            aria-pressed={daily === v}
            onClick={() => onChange(v)}
            className={cn(
              'px-2.5 py-1 text-xs rounded-lg border transition-colors',
              daily === v
                ? 'border-violet-500 bg-violet-50 dark:bg-violet-950/30 text-violet-600 dark:text-violet-400'
                : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="mt-1 text-[11px] text-gray-400">
        {daily
          ? `${daysInclusive(startDate, endDate)}일 동안 날마다 하루 플랜으로 보이고, 날마다 따로 완료해요`
          : '시작일부터 종료일까지 하나로 이어진 막대로 보여요'}
      </p>
    </div>
  )
}
