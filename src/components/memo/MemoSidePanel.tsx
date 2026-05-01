'use client'

import { useState, useMemo, useRef, useLayoutEffect } from 'react'
import { Search, X, ChevronRight } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { ko } from 'date-fns/locale'
import { cn } from '@/lib/utils'
import { useMemoStore } from '@/store/memoStore'
import { useMemos } from '@/hooks/useMemos'

const SCROLL_KEY = 'memo-side-panel-scroll'

interface MemoSidePanelProps {
  currentMemoId: string
  onSelect: (id: string) => void
  onClose: () => void
}

export default function MemoSidePanel({ currentMemoId, onSelect, onClose }: MemoSidePanelProps) {
  const { memos } = useMemoStore()
  useMemos(undefined)  // 빈 store일 때 자동 fetch + 동기화
  const [search, setSearch] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  // 마운트 시 저장된 스크롤 위치 복원 (paint 전 실행 → 깜빡임 없음)
  useLayoutEffect(() => {
    const saved = sessionStorage.getItem(SCROLL_KEY)
    if (saved && scrollRef.current) {
      scrollRef.current.scrollTop = parseInt(saved, 10)
    }
  }, [])

  const filtered = useMemo(() => {
    const active = memos.filter((m) => !m.isDeleted)
    if (!search.trim()) return active
    const q = search.toLowerCase()
    return active.filter((m) =>
      m.title.toLowerCase().includes(q) || m.contentText.toLowerCase().includes(q)
    )
  }, [memos, search])

  function handleSelect(id: string) {
    if (scrollRef.current) {
      sessionStorage.setItem(SCROLL_KEY, String(scrollRef.current.scrollTop))
    }
    onSelect(id)
  }

  return (
    <div className="flex flex-col w-56 flex-shrink-0 border-l border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 dark:border-gray-800">
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">메모 목록</span>
        <button
          onClick={onClose}
          className="p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 transition-colors"
        >
          <X size={13} />
        </button>
      </div>

      {/* 검색 */}
      <div className="px-2 py-2 border-b border-gray-100 dark:border-gray-800">
        <div className="relative">
          <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="검색..."
            className="w-full pl-6 pr-2 py-1.5 text-xs rounded-md border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 outline-none focus:ring-1 focus:ring-violet-400"
          />
        </div>
      </div>

      {/* 목록 */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-20 text-xs text-gray-400">결과 없음</div>
        ) : (
          filtered.map((memo) => {
            const isCurrent = memo.id === currentMemoId
            return (
              <button
                key={memo.id}
                onClick={() => !isCurrent && handleSelect(memo.id)}
                className={cn(
                  'w-full text-left px-3 py-2.5 border-b border-gray-50 dark:border-gray-800/50 transition-colors',
                  isCurrent
                    ? 'bg-violet-50 dark:bg-violet-950/30 cursor-default'
                    : 'hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer'
                )}
              >
                <div className="flex items-start justify-between gap-1">
                  <span className={cn(
                    'text-xs font-medium truncate flex-1',
                    isCurrent ? 'text-violet-700 dark:text-violet-300' : 'text-gray-800 dark:text-gray-200',
                    !memo.title && 'italic text-gray-400'
                  )}>
                    {memo.title || '제목 없음'}
                  </span>
                  {isCurrent && <ChevronRight size={10} className="text-violet-400 flex-shrink-0 mt-0.5" />}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-xs text-gray-400">
                    {formatDistanceToNow(new Date(memo.updatedAt), { addSuffix: true, locale: ko })}
                  </span>
                </div>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
