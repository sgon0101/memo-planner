'use client'

import { useState, useEffect } from 'react'
import { useMemoStore } from '@/store/memoStore'

interface Props {
  query: string
  position: { x: number; y: number }
  onSelect: (title: string) => void
  onClose: () => void
}

export default function WikiSuggest({ query, position, onSelect, onClose }: Props) {
  const { memos } = useMemoStore()
  const [selectedIndex, setSelectedIndex] = useState(0)

  const q = query.toLowerCase()
  const filtered = memos
    .filter((m) => !m.isDeleted && m.title && m.title.toLowerCase().includes(q))
    .slice(0, 8)
  const showNew = !!query && !filtered.some((m) => m.title === query)
  const totalItems = filtered.length + (showNew ? 1 : 0)

  useEffect(() => { setSelectedIndex(0) }, [query])

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((i) => Math.min(i + 1, totalItems - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((i) => Math.max(i - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        if (selectedIndex < filtered.length) {
          onSelect(filtered[selectedIndex].title)
        } else if (showNew) {
          onSelect(query)
        }
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handler, { capture: true })
    return () => window.removeEventListener('keydown', handler, { capture: true })
  }, [filtered, selectedIndex, query, showNew, totalItems, onSelect, onClose])

  if (totalItems === 0) return null

  return (
    <div
      className="fixed z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl py-1 w-64 max-h-56 overflow-y-auto"
      style={{ left: position.x, top: position.y + 20 }}
    >
      {filtered.map((m, i) => (
        <button
          key={m.id}
          onMouseDown={(e) => { e.preventDefault(); onSelect(m.title) }}
          className={`w-full text-left px-3 py-1.5 text-sm truncate transition-colors ${
            i === selectedIndex
              ? 'bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-300'
              : 'text-gray-700 dark:text-gray-300 hover:bg-violet-50 dark:hover:bg-violet-950/20'
          }`}
        >
          {m.title}
        </button>
      ))}
      {showNew && (
        <button
          onMouseDown={(e) => { e.preventDefault(); onSelect(query) }}
          className={`w-full text-left px-3 py-1.5 text-sm transition-colors border-t border-gray-100 dark:border-gray-700 ${
            selectedIndex === filtered.length
              ? 'bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-300'
              : 'text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-950/20'
          }`}
        >
          + 새 위키 <span className="font-medium">[[{query}]]</span> 만들기
        </button>
      )}
    </div>
  )
}
