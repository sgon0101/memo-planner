'use client'

// MemoList.tsx에서 순수 이동(로직 변경 0)한 하위 컴포넌트 모음 — 2026-07-04 분리
// TagDropdown / WikiDropdown / SortChip / TitleSortDropdown / MemoSection
// useFloatingDropdown은 위 드롭다운들의 내부 전용 훅

import { useState, useEffect, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import MemoCard from './MemoCard'
import { useMemos } from '@/hooks/useMemos'

export type SortKey = 'updated' | 'created' | 'title' | 'starred' | 'pinned'

export type TitleDir = 'asc' | 'desc'

export function TagDropdown({
  allTags,
  selectedTag,
  onSelect,
}: {
  allTags: string[]
  selectedTag: string | null
  onSelect: (tag: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const coords = useFloatingDropdown(open, triggerRef, panelRef, () => setOpen(false), { panelWidth: 220 })

  function handleSelect(tag: string | null) {
    onSelect(tag)
    setOpen(false)
  }

  return (
    <>
      <button
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex-shrink-0 flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border transition-colors',
          selectedTag
            ? 'border-cyan-500 bg-cyan-50 dark:bg-cyan-950/30 text-cyan-600 dark:text-cyan-400'
            : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300',
        )}
      >
        <span>#</span>
        <span>{selectedTag ? selectedTag.replace(/^#/, '') : '태그'}</span>
        {selectedTag ? (
          <span
            role="button"
            aria-label="태그 필터 해제"
            onClick={(e) => { e.stopPropagation(); handleSelect(null) }}
            className="ml-0.5 font-bold leading-none hover:opacity-70"
          >
            ✕
          </span>
        ) : (
          <span className="text-[10px] leading-none">▾</span>
        )}
      </button>

      {open && coords && typeof document !== 'undefined' && createPortal(
        <div
          ref={panelRef}
          style={{ position: 'fixed', top: coords.top, left: coords.left, zIndex: 100, width: 220 }}
          className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl max-h-80 overflow-y-auto py-1"
        >
          <div
            onClick={() => handleSelect(null)}
            className={cn(
              'flex items-center gap-2 px-3.5 py-2 text-xs cursor-pointer transition-colors',
              !selectedTag
                ? 'bg-cyan-50 dark:bg-cyan-950/20 text-cyan-600 dark:text-cyan-400 font-medium'
                : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800',
            )}
          >
            {!selectedTag && <span>✓</span>}
            <span>전체</span>
            <span className="ml-auto text-[10px] text-gray-400">{allTags.length}개</span>
          </div>
          {allTags.length === 0 ? (
            <div className="px-3.5 py-3 text-xs text-gray-400 text-center">이 폴더에 등록된 태그가 없어요</div>
          ) : (
            allTags.map((tag) => (
              <div
                key={tag}
                onClick={() => handleSelect(tag)}
                className={cn(
                  'flex items-center gap-2 px-3.5 py-2 text-xs cursor-pointer transition-colors',
                  selectedTag === tag
                    ? 'bg-cyan-50 dark:bg-cyan-950/20 text-cyan-600 dark:text-cyan-400 font-medium'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800',
                )}
              >
                {selectedTag === tag && <span>✓</span>}
                <span className="truncate">{tag}</span>
              </div>
            ))
          )}
        </div>,
        document.body,
      )}
    </>
  )
}

/**
 * 드롭다운 패널을 portal + position:fixed로 띄우는 공용 hook.
 * 트리거 위치 기반으로 좌표 계산, 화면 우측 가장자리 clamp, 스크롤/리사이즈 추적.
 * 외부 클릭 + Esc로 onClose 호출.
 */
function useFloatingDropdown(
  open: boolean,
  triggerRef: React.RefObject<HTMLElement | null>,
  panelRef: React.RefObject<HTMLElement | null>,
  onClose: () => void,
  options?: { panelWidth?: number },
): { top: number; left: number } | null {
  const panelWidth = options?.panelWidth ?? 240
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 닫힘 시 좌표 리셋 (의도된 패턴)
    if (!open) { setCoords(null); return }
    function update() {
      const trigger = triggerRef.current
      if (!trigger) return
      const r = trigger.getBoundingClientRect()
      const vw = window.innerWidth
      let left = r.left
      if (left + panelWidth > vw - 8) left = vw - panelWidth - 8
      if (left < 8) left = 8
      setCoords({ top: r.bottom + 6, left })
    }
    update()
    window.addEventListener('scroll', update, true)
    window.addEventListener('resize', update)
    return () => {
      window.removeEventListener('scroll', update, true)
      window.removeEventListener('resize', update)
    }
  }, [open, triggerRef, panelWidth])

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent | TouchEvent) {
      const t = e.target as Node
      if (triggerRef.current?.contains(t)) return
      if (panelRef.current?.contains(t)) return
      onClose()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose, triggerRef, panelRef])

  return coords
}

export function SortChip({
  value, current, onSelect, children,
}: {
  value: SortKey
  current: SortKey
  onSelect: (v: SortKey) => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={() => onSelect(value)}
      className={cn(
        'flex-shrink-0 text-xs px-2.5 py-1 rounded-full border transition-colors',
        current === value
          ? 'border-violet-500 bg-violet-50 dark:bg-violet-950/30 text-violet-600 dark:text-violet-400'
          : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300',
      )}
    >
      {children}
    </button>
  )
}

export function WikiDropdown({
  allWikis,
  selectedWiki,
  onSelect,
}: {
  allWikis: string[]
  selectedWiki: string | null
  onSelect: (w: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const coords = useFloatingDropdown(open, triggerRef, panelRef, () => setOpen(false), { panelWidth: 240 })

  function handleSelect(wiki: string | null) {
    onSelect(wiki)
    setOpen(false)
  }

  return (
    <>
      <button
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex-shrink-0 flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border transition-colors',
          selectedWiki
            ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400'
            : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300',
        )}
      >
        <span>[[</span>
        <span className="truncate max-w-[8rem]">{selectedWiki ? selectedWiki : '위키'}</span>
        {selectedWiki ? (
          <span
            role="button"
            aria-label="위키 필터 해제"
            onClick={(e) => { e.stopPropagation(); handleSelect(null) }}
            className="ml-0.5 font-bold leading-none hover:opacity-70"
          >
            ✕
          </span>
        ) : (
          <span className="text-[10px] leading-none">▾</span>
        )}
      </button>

      {open && coords && typeof document !== 'undefined' && createPortal(
        <div
          ref={panelRef}
          style={{ position: 'fixed', top: coords.top, left: coords.left, zIndex: 100, width: 240 }}
          className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl max-h-80 overflow-y-auto py-1"
        >
          <div
            onClick={() => handleSelect(null)}
            className={cn(
              'flex items-center gap-2 px-3.5 py-2 text-xs cursor-pointer transition-colors',
              !selectedWiki
                ? 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 font-medium'
                : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800',
            )}
          >
            {!selectedWiki && <span>✓</span>}
            <span>전체</span>
            <span className="ml-auto text-[10px] text-gray-400">{allWikis.length}개</span>
          </div>
          {allWikis.length === 0 ? (
            <div className="px-3.5 py-3 text-xs text-gray-400 text-center">이 폴더에 등록된 위키링크가 없어요</div>
          ) : (
            allWikis.map((wiki) => (
              <div
                key={wiki}
                onClick={() => handleSelect(wiki)}
                className={cn(
                  'flex items-center gap-2 px-3.5 py-2 text-xs cursor-pointer transition-colors',
                  selectedWiki === wiki
                    ? 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 font-medium'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800',
                )}
              >
                {selectedWiki === wiki && <span>✓</span>}
                <span className="truncate">{wiki}</span>
              </div>
            ))
          )}
        </div>,
        document.body,
      )}
    </>
  )
}

export function MemoSection({ memos, view, cols = 4, isTrash = false, onPin, onStar, onDelete, onLock, onUnlock, onRestore, onPermanentDelete, onMoveToFolder, selectedTrashIds, onToggleSelect, searchQuery }: {
  memos: ReturnType<typeof useMemos>['memos']
  view: 'card' | 'list'
  cols?: 4 | 5 | 6
  isTrash?: boolean
  onPin: (id: string, cur: boolean) => void
  onStar: (id: string, cur: boolean) => void
  onDelete: (id: string) => void
  onLock: (id: string, content: Record<string, unknown>, pw: string) => Promise<void>
  onUnlock: (id: string, locked: string, pw: string) => Promise<void>
  onRestore: (id: string) => void
  onPermanentDelete: (id: string) => void
  onMoveToFolder?: (id: string, folderId: string | null) => void
  selectedTrashIds?: Set<string>
  onToggleSelect?: (id: string) => void
  searchQuery?: string
}) {
  const props = { view, isTrash, onPin, onStar, onDelete, onLock, onUnlock, onRestore, onPermanentDelete, onMoveToFolder, onToggleSelect, searchQuery }
  if (view === 'card') {
    // Tailwind는 동적 클래스를 인식하지 못하므로 완전한 클래스명을 나열
    const colClass = cols === 6
      ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6'
      : cols === 5
        ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5'
        : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
    return (
      <div className={cn('grid gap-3', colClass)}>
        {memos.map((m) => (
          <MemoCard key={m.id} memo={m} isSelected={selectedTrashIds?.has(m.id) ?? false} {...props} />
        ))}
      </div>
    )
  }
  return (
    <div>
      {memos.map((m) => (
        <MemoCard key={m.id} memo={m} isSelected={selectedTrashIds?.has(m.id) ?? false} {...props} />
      ))}
    </div>
  )
}

export function TitleSortDropdown({
  isActive,
  dir,
  onSelect,
}: {
  isActive: boolean
  dir: TitleDir
  onSelect: (dir: TitleDir) => void
}) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const coords = useFloatingDropdown(open, triggerRef, panelRef, () => setOpen(false), { panelWidth: 180 })

  const OPTIONS: { value: TitleDir; label: string; icon: string }[] = [
    { value: 'asc',  label: '오름차순 (ㄱ → ㅎ)', icon: '↑' },
    { value: 'desc', label: '내림차순 (ㅎ → ㄱ)', icon: '↓' },
  ]

  return (
    <>
      <button
        ref={triggerRef}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex-shrink-0 flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border transition-colors',
          isActive
            ? 'border-violet-500 bg-violet-50 dark:bg-violet-950/30 text-violet-600 dark:text-violet-400'
            : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300',
        )}
      >
        이름순
        <span className="text-[10px] leading-none font-mono">
          {isActive ? (dir === 'asc' ? '↑' : '↓') : '▾'}
        </span>
      </button>

      {open && coords && typeof document !== 'undefined' && createPortal(
        <div
          ref={panelRef}
          style={{ position: 'fixed', top: coords.top, left: coords.left, zIndex: 100, width: 180 }}
          className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl overflow-hidden"
        >
          {OPTIONS.map(({ value, label, icon }) => (
            <div
              key={value}
              onClick={() => { onSelect(value); setOpen(false) }}
              className={cn(
                'flex items-center gap-2 px-3.5 py-2.5 text-xs cursor-pointer transition-colors select-none',
                isActive && dir === value
                  ? 'bg-violet-50 dark:bg-violet-950/20 text-violet-600 dark:text-violet-400 font-medium'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800',
              )}
            >
              <span className="w-3 text-center font-mono">{icon}</span>
              <span className="flex-1">{label}</span>
              {isActive && dir === value && <span className="text-violet-500">✓</span>}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}
