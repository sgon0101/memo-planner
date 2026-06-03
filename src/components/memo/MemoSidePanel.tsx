'use client'

import { useState, useMemo, useRef, useLayoutEffect } from 'react'
import { Search, X, ChevronRight } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { ko } from 'date-fns/locale'
import { cn } from '@/lib/utils'
import { useMemos } from '@/hooks/useMemos'
import RelatedMemosPanel from './RelatedMemosPanel'

const SCROLL_KEY = 'memo-side-panel-scroll'

interface MemoSidePanelProps {
  currentMemoId: string
  folderId: string | null
  onSelect: (id: string) => void
  onClose: () => void
}

export default function MemoSidePanel({ currentMemoId, folderId, onSelect, onClose }: MemoSidePanelProps) {
  // useMemos에서 null은 전체 보기 → 전체 캐시 공유 후 여기서 폴더 필터링
  const { memos: allMemos, isLoading, isFetching } = useMemos(folderId)
  // 로딩 중이거나, fetch 중인데 아직 데이터가 없으면 스켈레톤 표시
  const showSkeleton = isLoading || (isFetching && allMemos.length === 0)
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
    // 폴더 필터링: null이면 폴더 없는 메모, uuid이면 해당 폴더 메모
    const folderFiltered = folderId === null
      ? allMemos.filter((m) => !m.isDeleted && m.folderId === null)
      : allMemos.filter((m) => !m.isDeleted && m.folderId === folderId)
    if (!search.trim()) return folderFiltered
    const q = search.toLowerCase()
    return folderFiltered.filter((m) =>
      m.title.toLowerCase().includes(q) || m.contentText.toLowerCase().includes(q)
    )
  }, [allMemos, folderId, search])

  function handleSelect(id: string) {
    if (scrollRef.current) {
      sessionStorage.setItem(SCROLL_KEY, String(scrollRef.current.scrollTop))
    }
    onSelect(id)
  }

  // ─────────────────────────────────────────────────
  // 모바일 swipe-right 닫기 (PointerEvent 통합)
  //  - 가로 이동이 세로보다 크면 활성화 (스크롤 보존)
  //  - 우측으로 드래그하면 panel이 손가락 따라옴
  //  - 100px+ 이동 시 onClose, 아니면 spring back
  //  - md 이상에서는 무시
  // ─────────────────────────────────────────────────
  const [dragX, setDragX] = useState(0)
  const dragRef = useRef<{ startX: number; startY: number; active: boolean }>({
    startX: 0, startY: 0, active: false,
  })

  function onPointerDown(e: React.PointerEvent) {
    if (typeof window !== 'undefined' && window.innerWidth >= 768) return
    const target = e.target as HTMLElement
    // 버튼/input/scrollable에서 시작한 경우는 native 동작 우선
    if (target.closest('input, textarea, button')) return
    dragRef.current = { startX: e.clientX, startY: e.clientY, active: false }
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!dragRef.current.startX) return
    const dx = e.clientX - dragRef.current.startX
    const dy = e.clientY - dragRef.current.startY

    if (!dragRef.current.active) {
      // 시작 임계값 — 5px 이내는 탭으로 간주
      if (Math.abs(dx) < 5 && Math.abs(dy) < 5) return
      // 세로 이동이 더 크면 스크롤 의도 — 드래그 취소
      if (Math.abs(dy) > Math.abs(dx)) {
        dragRef.current.startX = 0
        return
      }
      // 가로 + 우측 방향이면 활성화 (왼쪽 드래그는 무시)
      if (dx < 0) {
        dragRef.current.startX = 0
        return
      }
      dragRef.current.active = true
    }

    setDragX(Math.max(0, dx))
  }

  function onPointerUp(e: React.PointerEvent) {
    if (!dragRef.current.active) {
      dragRef.current = { startX: 0, startY: 0, active: false }
      setDragX(0)
      return
    }
    const dx = e.clientX - dragRef.current.startX
    dragRef.current = { startX: 0, startY: 0, active: false }
    // 100px 이상 우측 드래그 → 닫힘
    if (dx > 100) {
      setDragX(0)
      onClose()
    } else {
      // spring back
      setDragX(0)
    }
  }

  return (
    <>
      {/* 모바일 백드롭 — 탭하면 닫힘. md 이상에서는 안 보임 */}
      <button
        type="button"
        aria-label="패널 닫기"
        onClick={onClose}
        className="md:hidden fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px]"
      />
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={{
        transform: dragX > 0 ? `translateX(${dragX}px)` : undefined,
        transition: dragRef.current.active ? 'none' : 'transform 0.18s ease-out',
        touchAction: 'pan-y',
      }}
      className={cn(
        // 공통
        "flex flex-col border-l border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900",
        // 모바일 — 우측에서 슬라이드 오버레이, 백드롭 위에 떠 있음
        "max-md:fixed max-md:inset-y-0 max-md:right-0 max-md:z-50 max-md:w-[82vw] max-md:max-w-[360px] max-md:shadow-2xl",
        // 데스크탑 — 인라인 사이드 패널
        "md:w-56 md:flex-shrink-0",
      )}>
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

      {/* 관련 메모 (의미 기반) */}
      <RelatedMemosPanel memoId={currentMemoId} />

      {/* 목록 */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {showSkeleton ? (
          <div className="flex flex-col">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="px-3 py-2.5 border-b border-gray-50 dark:border-gray-800/50">
                <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-3/4 mb-1.5 animate-pulse" />
                <div className="h-2.5 bg-gray-100 dark:bg-gray-800 rounded w-1/2 animate-pulse" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
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
    </>
  )
}
