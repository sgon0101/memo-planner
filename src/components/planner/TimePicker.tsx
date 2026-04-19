'use client'

import { cn } from '@/lib/utils'

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => ({
  value: i,
  label: i.toString().padStart(2, '0'),
}))

const MINUTE_OPTIONS = [0, 10, 20, 30, 40, 50].map((m) => ({
  value: m,
  label: m.toString().padStart(2, '0'),
}))

interface TimePickerProps {
  label: string
  value: string        // "HH:MM" 형식
  onChange: (value: string) => void
  className?: string
}

export default function TimePicker({ label, value, onChange, className }: TimePickerProps) {
  const parts = value ? value.split(':').map(Number) : [9, 0]
  const hour = isNaN(parts[0]) ? 9 : parts[0]
  const minute = isNaN(parts[1]) ? 0 : Math.round(parts[1] / 10) * 10

  function emit(h: number, m: number) {
    onChange(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
  }

  const selectCls = cn(
    'px-2 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700',
    'bg-white dark:bg-gray-800 text-gray-900 dark:text-white',
    'outline-none focus:ring-1 focus:ring-violet-500 cursor-pointer',
  )

  return (
    <div className={className}>
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <div className="flex items-center gap-1.5">
        <select
          value={hour}
          onChange={(e) => emit(Number(e.target.value), minute)}
          className={selectCls}
        >
          {HOUR_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <span className="text-gray-500 font-medium">:</span>
        <select
          value={minute}
          onChange={(e) => emit(hour, Number(e.target.value))}
          className={selectCls}
        >
          {MINUTE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
    </div>
  )
}
