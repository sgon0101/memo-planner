'use client'

import { cn } from '@/lib/utils'

interface Props {
  selected: boolean
  label: string
  icon: React.ReactNode
  itemRef: (el: HTMLButtonElement | null) => void
  onMouseEnter: () => void
  onSelect: () => void
}

/**
 * SlashCommand 메뉴 항목 1줄.
 *
 * SlashCommand 본 파일이 sync 도구에 의해 끝부분이 잘리는 이슈를 우회하려고
 * 별도 컴포넌트로 분리. 본 파일은 이걸 import해서 짧게 유지.
 */
export default function SlashCommandItem({
  selected, label, icon, itemRef, onMouseEnter, onSelect,
}: Props) {
  return (
    <button
      ref={itemRef}
      role="option"
      aria-selected={selected}
      onMouseEnter={onMouseEnter}
      onMouseDown={(e) => { e.preventDefault(); onSelect() }}
      className={cn(
        'w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors cursor-pointer',
        selected
          ? 'bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-300'
          : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50',
      )}
    >
      <span
        className={cn(
          'flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-md border border-gray-200 dark:border-gray-700',
          selected
            ? 'bg-white dark:bg-gray-800 text-violet-600 dark:text-violet-400'
            : 'text-gray-500 dark:text-gray-400',
        )}
      >
        {icon}
      </span>
      <span className="flex-1 truncate">{label}</span>
    </button>
  )
}
