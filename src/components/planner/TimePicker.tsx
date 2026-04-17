'use client'

import { cn } from '@/lib/utils'

interface TimePickerProps {
  label: string
  value: string
  onChange: (value: string) => void
  className?: string
}

export default function TimePicker({ label, value, onChange, className }: TimePickerProps) {
  return (
    <div className={className}>
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <input
        type="time"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          'w-full px-2.5 py-1.5 text-sm rounded-lg border',
          'border-gray-300 dark:border-gray-700',
          'bg-white dark:bg-gray-800 text-gray-900 dark:text-white',
          'outline-none focus:ring-1 focus:ring-violet-500',
          'cursor-pointer'
        )}
      />
    </div>
  )
}
