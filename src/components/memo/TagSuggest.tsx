'use client'

import { useMemoStore } from '@/store/memoStore'

interface Props {
  query: string
  position: { x: number; y: number }
  onSelect: (tag: string) => void
}

export default function TagSuggest({ query, position, onSelect }: Props) {
  const { memos } = useMemoStore()
  const q = query.toLowerCase()

  const allTags = [...new Set(memos.flatMap((m) => m.tags ?? []))]
  const filtered = allTags
    .filter((t) => t.toLowerCase().includes(q))
    .slice(0, 8)

  if (filtered.length === 0 && !query) return null

  return (
    <div
      className="fixed z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl py-1 w-52 max-h-56 overflow-y-auto"
      style={{ left: position.x, top: position.y + 20 }}
    >
      {filtered.map((tag) => (
        <button
          key={tag}
          onMouseDown={(e) => { e.preventDefault(); onSelect(tag) }}
          className="w-full text-left px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-violet-50 dark:hover:bg-violet-950/30 truncate"
        >
          <span className="text-violet-400">#</span>{tag}
        </button>
      ))}
      {query && !filtered.includes(query) && (
        <button
          onMouseDown={(e) => { e.preventDefault(); onSelect(query) }}
          className="w-full text-left px-3 py-1.5 text-sm text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-950/30"
        >
          + 새 태그 <span className="font-medium">#{query}</span> 만들기
        </button>
      )}
    </div>
  )
}
