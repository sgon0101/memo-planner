'use client'

import { useMemoStore } from '@/store/memoStore'

interface Props {
  query: string
  position: { x: number; y: number }
  onSelect: (title: string) => void
}

export default function WikiSuggest({ query, position, onSelect }: Props) {
  const { memos } = useMemoStore()
  const q = query.toLowerCase()
  const filtered = memos
    .filter((m) => !m.isDeleted && m.title && m.title.toLowerCase().includes(q))
    .slice(0, 8)

  if (filtered.length === 0) return null

  return (
    <div
      className="fixed z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl py-1 w-64 max-h-56 overflow-y-auto"
      style={{ left: position.x, top: position.y + 20 }}
    >
      {filtered.map((m) => (
        <button
          key={m.id}
          onMouseDown={(e) => { e.preventDefault(); onSelect(m.title) }}
          className="w-full text-left px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-violet-50 dark:hover:bg-violet-950/30 truncate"
        >
          {m.title}
        </button>
      ))}
    </div>
  )
}
