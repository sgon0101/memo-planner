'use client'

import { useState, useEffect, useRef } from 'react'
import { useAllMemosMeta } from '@/hooks/useAllMemosMeta'

interface Props {
  query: string
  position: { x: number; y: number }
  onSelect: (tag: string) => void
  onClose: () => void
}

export default function TagSuggest({ query, position, onSelect, onClose }: Props) {
  const { allTags } = useAllMemosMeta()
  const [selectedIndex, setSelectedIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const q = query.toLowerCase()
  const filtered = allTags.filter((t) => t.toLowerCase().includes(q)).slice(0, 8)
  const showNew = !!query && !filtered.includes(query)
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
          onSelect(filtered[selectedIndex])
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
      ref={listRef}
      className="fixed z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl py-1 w-52 max-h-56 overflow-y-auto"
      style={{ left: position.x, top: position.y + 20 }}
    >
      {filtered.map((tag, i) => (
        <button
          key={tag}
          onMouseDown={(e) => { e.preventDefault(); onSelect(tag) }}
          className={`w-full text-left px-3 py-1.5 text-sm truncate transition-colors ${
            i === selectedIndex
              ? 'bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-300'
              : 'text-gray-700 dark:text-gray-300 hover:bg-violet-50 dark:hover:bg-violet-950/20'
          }`}
        >
          <span className="text-violet-400">#</span>{tag}
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
          + 새 태그 <span className="font-medium">#{query}</span> 만들기
        </button>
      )}
    </div>
  )
}
