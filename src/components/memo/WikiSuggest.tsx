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
  const allWikiLinks = [...new Set(memos.flatMap((m) => m.wikiLinks ?? []))].sort()
  const filtered = allWikiLinks.filter((kw) => kw.toLowerCase().includes(q)).slice(0, 8)
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
      className="fixed z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl py-1 w-64 max-h-56 overflow-y-auto"
      style={{ left: position.x, top: position.y + 20 }}
    >
      {filtered.map((kw, i) => (
        <button
          key={kw}
          onMouseDown={(e) => { e.preventDefault(); onSelect(kw) }}
          className={`w-full text-left px-3 py-1.5 text-sm truncate transition-colors ${
            i === selectedIndex
              ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300'
              : 'text-gray-700 dark:text-gray-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/20'
          }`}
        >
          <span className="text-emerald-500 font-medium">[[</span>
          {kw}
          <span className="text-emerald-500 font-medium">]]</span>
        </button>
      ))}
      {showNew && (
        <button
          onMouseDown={(e) => { e.preventDefault(); onSelect(query) }}
          className={`w-full text-left px-3 py-1.5 text-sm transition-colors border-t border-gray-100 dark:border-gray-700 ${
            selectedIndex === filtered.length
              ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300'
              : 'text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/20'
          }`}
        >
          + 새 위키 <span className="font-medium">[[{query}]]</span> 만들기
        </button>
      )}
    </div>
  )
}
