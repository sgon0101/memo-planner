'use client'

import { useState, useEffect, useLayoutEffect } from 'react'
import { useAllMemosMeta } from '@/hooks/useAllMemosMeta'

interface Props {
  query: string
  position: { x: number; y: number }
  onSelect: (title: string) => void
  onClose: () => void
}

// 드롭다운 최대 높이 — max-h-56 + py-1 + border + 약간 여유
const DROPDOWN_MAX_HEIGHT = 260

export default function WikiSuggest({ query, position, onSelect, onClose }: Props) {
  const { allWikiLinks } = useAllMemosMeta()
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [flipUp, setFlipUp] = useState(false)

  const q = query.toLowerCase()
  const filtered = allWikiLinks.filter((kw) => kw.toLowerCase().includes(q)).slice(0, 8)
  const showNew = !!query && !filtered.includes(query)
  const totalItems = filtered.length + (showNew ? 1 : 0)

  // eslint-disable-next-line react-hooks/set-state-in-effect -- 검색어 변경 시 선택 인덱스 리셋 (의도된 패턴)
  useEffect(() => { setSelectedIndex(0) }, [query])

  // viewport 가용 공간 측정 → 아래 부족하면 위로 flip
  useLayoutEffect(() => {
    function compute() {
      if (typeof window === 'undefined') return
      const spaceBelow = window.innerHeight - position.y
      const spaceAbove = position.y
      setFlipUp(spaceBelow < DROPDOWN_MAX_HEIGHT && spaceAbove > DROPDOWN_MAX_HEIGHT)
    }
    compute()
    window.addEventListener('resize', compute)
    return () => window.removeEventListener('resize', compute)
  }, [position.y, totalItems])

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
      style={
        flipUp
          ? { left: position.x, top: position.y - 8, transform: 'translateY(-100%)' }
          : { left: position.x, top: position.y + 20 }
      }
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
