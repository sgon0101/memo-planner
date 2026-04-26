'use client'

import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, LayoutGrid, List, AlignLeft, Search, Trash2, RotateCcw } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { ko } from 'date-fns/locale'
import { cn } from '@/lib/utils'
import { useFolderStore } from '@/store/folderStore'
import { useMemos } from '@/hooks/useMemos'
import { MemoListSkeleton } from '@/components/ui/Skeleton'
import MemoCard from './MemoCard'
import TimelineFilter from './TimelineFilter'

const PAGE_SIZE = 20

type SortKey = 'updated' | 'created' | 'title' | 'starred' | 'pinned'
type ViewMode = 'card' | 'list' | 'timeline'

export default function MemoList() {
  const router = useRouter()
  const { selectedFolderId, folders } = useFolderStore()
  const {
    memos, isLoading, isTrash,
    togglePin, toggleStar, softDelete,
    lockMemo, unlockMemo,
    restoreMemo, bulkRestore, permanentDelete, emptyTrash,
    moveMemoToFolder,
  } = useMemos(selectedFolderId)

  const [displayCount, setDisplayCount] = useState(PAGE_SIZE)
  const [selectedTrashIds, setSelectedTrashIds] = useState<Set<string>>(new Set())
  const selectAllRef = useRef<HTMLInputElement>(null)
  // 콜백 ref: sentinel이 DOM에 나타나는 순간 observer를 연결, 사라지면 해제
  // useEffect 방식은 마운트 시 1회만 실행되어 데이터 로딩 후 sentinel이 생겨도 감지 불가
  const obsRef = useRef<IntersectionObserver | null>(null)
  const sentinelRef = useCallback((el: HTMLDivElement | null) => {
    obsRef.current?.disconnect()
    obsRef.current = null
    if (!el) return
    obsRef.current = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) setDisplayCount((n) => n + PAGE_SIZE) },
      { threshold: 0.1 }
    )
    obsRef.current.observe(el)
  }, []) // setDisplayCount는 React 보장 stable → deps 불필요

  // 폴더 변경 시 표시 개수 + 선택 초기화
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setDisplayCount(PAGE_SIZE); setSelectedTrashIds(new Set()) }, [selectedFolderId])

  // 전체 선택 체크박스 indeterminate 상태
  useEffect(() => {
    if (!selectAllRef.current) return
    const total = memos.length
    selectAllRef.current.indeterminate = selectedTrashIds.size > 0 && selectedTrashIds.size < total
  }, [selectedTrashIds.size, memos.length])

  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortKey>('updated')
  const [view, setView] = useState<ViewMode>('card')
  const [activeTag, setActiveTag] = useState<string | null>(null)

  // 카드 컬럼 수 (4~6), localStorage에 저장
  const [cols, setCols] = useState<4 | 5 | 6>(() => {
    if (typeof window === 'undefined') return 4
    const saved = localStorage.getItem('memo-card-cols')
    return (saved === '5' ? 5 : saved === '6' ? 6 : 4) as 4 | 5 | 6
  })
  function updateCols(n: 4 | 5 | 6) {
    setCols(n)
    localStorage.setItem('memo-card-cols', String(n))
  }
  // 타임라인 전용 필터
  const [tlStartDate, setTlStartDate] = useState<string | null>(null)
  const [tlEndDate, setTlEndDate] = useState<string | null>(null)
  const [tlMonth, setTlMonth] = useState<string | null>(null)

  const folderName = isTrash
    ? '휴지통'
    : selectedFolderId
      ? folders.find((f) => f.id === selectedFolderId)?.name ?? '폴더'
      : '전체 메모'

  // 모든 태그 수집
  const allTags = useMemo(() => {
    const set = new Set<string>()
    memos.forEach((m) => m.tags?.forEach((t) => set.add(t)))
    return Array.from(set)
  }, [memos])

  const filtered = useMemo(() => {
    let list = [...memos]

    if (search) {
      const q = search.toLowerCase()
      list = list.filter((m) =>
        m.title.toLowerCase().includes(q) || m.contentText.toLowerCase().includes(q)
      )
    }

    if (activeTag) {
      list = list.filter((m) => m.tags?.includes(activeTag))
    }

    if (!isTrash) {
      list.sort((a, b) => {
        if (sort === 'title') return a.title.localeCompare(b.title, 'ko')
        if (sort === 'created') return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        if (sort === 'starred') {
          if (b.isStarred !== a.isStarred) return Number(b.isStarred) - Number(a.isStarred)
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        }
        if (sort === 'pinned') {
          if (b.isPinned !== a.isPinned) return Number(b.isPinned) - Number(a.isPinned)
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
        }
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      })
    }

    const pinned = list.filter((m) => m.isPinned)
    const rest = list.filter((m) => !m.isPinned)
    return { pinned, rest, all: list }
  }, [memos, search, sort, isTrash, activeTag])

  // 타임라인 전용 필터 적용
  const timelineFiltered = useMemo(() => {
    let list = [...filtered.all]
    if (tlMonth) {
      list = list.filter((m) => m.updatedAt.startsWith(tlMonth))
    } else {
      if (tlStartDate) list = list.filter((m) => m.updatedAt.slice(0, 10) >= tlStartDate)
      if (tlEndDate) list = list.filter((m) => m.updatedAt.slice(0, 10) <= tlEndDate)
    }
    return list
  }, [filtered.all, tlStartDate, tlEndDate, tlMonth])

  // 타임라인: 연·월 → 일별 2단계 그룹핑
  const timelineGroups = useMemo(() => {
    const monthMap = new Map<string, Map<string, typeof memos>>()
    timelineFiltered.forEach((m) => {
      const mKey = format(parseISO(m.updatedAt), 'yyyy년 M월', { locale: ko })
      const dKey = format(parseISO(m.updatedAt), 'MM.dd (EEE)', { locale: ko })
      if (!monthMap.has(mKey)) monthMap.set(mKey, new Map())
      const dm = monthMap.get(mKey)!
      if (!dm.has(dKey)) dm.set(dKey, [])
      dm.get(dKey)!.push(m)
    })
    return [...monthMap.entries()].map(([monthLabel, dm]) => ({
      monthLabel,
      days: [...dm.entries()].map(([dayLabel, ms]) => ({ dayLabel, memos: ms })),
    }))
  }, [timelineFiltered])

  // 타임라인 필터용 월 목록 (현재 filtered.all 기준)
  const tlAllMonths = useMemo(() => {
    const set = new Set<string>()
    filtered.all.forEach((m) => set.add(m.updatedAt.slice(0, 7)))
    return [...set].sort().reverse()
  }, [filtered.all])

  function toggleTrashSelect(id: string) {
    setSelectedTrashIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAllTrash() {
    setSelectedTrashIds(new Set(memos.map((m) => m.id)))
  }

  function deselectAllTrash() {
    setSelectedTrashIds(new Set())
  }

  async function handleBulkRestore() {
    const ids = [...selectedTrashIds]
    if (ids.length === 0) return
    await bulkRestore(ids).catch(console.error)
    setSelectedTrashIds(new Set())
  }

  async function handleRestoreAll() {
    if (memos.length === 0) return
    if (!confirm(`휴지통의 메모 ${memos.length}개를 모두 복원할까요?`)) return
    await bulkRestore(memos.map((m) => m.id)).catch(console.error)
    setSelectedTrashIds(new Set())
  }

  const cardActions = {
    onPin: (id: string, cur: boolean) => togglePin(id, cur).catch(console.error),
    onStar: (id: string, cur: boolean) => toggleStar(id, cur).catch(console.error),
    onDelete: (id: string) => softDelete(id).catch(console.error),
    onLock: (id: string, content: Record<string, unknown>, pw: string) => lockMemo(id, content, pw),
    onUnlock: (id: string, locked: string, pw: string) => unlockMemo(id, locked, pw),
    onRestore: (id: string) => restoreMemo(id).catch(console.error),
    onPermanentDelete: (id: string) => permanentDelete(id).catch(console.error),
    onMoveToFolder: (id: string, folderId: string | null) => moveMemoToFolder(id, folderId).catch(console.error),
  }

  const SORT_OPTIONS: { value: SortKey; label: string }[] = [
    { value: 'updated', label: '최신순' },
    { value: 'created', label: '생성순' },
    { value: 'starred', label: '중요먼저' },
    { value: 'pinned', label: '고정먼저' },
    { value: 'title', label: '이름순' },
  ]

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-950">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <h2 className={cn('text-sm font-semibold', isTrash ? 'text-red-500' : 'text-gray-800 dark:text-gray-200')}>
          {folderName}
        </h2>
        {isTrash ? (
          <div className="flex items-center gap-2">
            <button
              onClick={handleRestoreAll}
              disabled={memos.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-950/20 rounded-lg transition-colors disabled:opacity-40"
            >
              <RotateCcw size={12} /> 전체 복원
            </button>
            <button
              onClick={() => {
                if (memos.length === 0) return
                if (confirm(`휴지통을 비울까요? ${memos.length}개의 메모가 영구 삭제됩니다.`))
                  emptyTrash().catch(console.error)
              }}
              disabled={memos.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 rounded-lg transition-colors disabled:opacity-40"
            >
              <Trash2 size={12} /> 휴지통 비우기
            </button>
          </div>
        ) : (
          <button
            onClick={() => router.push(selectedFolderId ? `/memo/new?folder=${selectedFolderId}` : '/memo/new')}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium rounded-lg transition-colors"
          >
            <Plus size={13} /> 새 메모
          </button>
        )}
      </div>

      {/* 검색 + 뷰 전환 */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <div className="flex-1 relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="메모 검색..."
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 outline-none focus:ring-1 focus:ring-violet-400"
          />
        </div>
        {/* 뷰 전환 버튼 */}
        <div className="flex items-center gap-1.5">
          <div className="flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            {([
              { mode: 'card', icon: <LayoutGrid size={13} />, title: '카드' },
              { mode: 'list', icon: <List size={13} />, title: '목록' },
              { mode: 'timeline', icon: <AlignLeft size={13} />, title: '타임라인' },
            ] as const).map(({ mode, icon, title }) => (
              <button
                key={mode}
                onClick={() => setView(mode)}
                title={title}
                className={cn('p-1.5 transition-colors', view === mode ? 'bg-violet-100 dark:bg-violet-900/40 text-violet-600' : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800')}
              >
                {icon}
              </button>
            ))}
          </div>
          {/* 카드 뷰 컬럼 수 선택 (4~6) */}
          {view === 'card' && !isTrash && (
            <div className="flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
              {([4, 5, 6] as const).map((n) => (
                <button
                  key={n}
                  onClick={() => updateCols(n)}
                  title={`한 줄에 ${n}개`}
                  className={cn(
                    'px-2 py-1 text-[11px] font-medium transition-colors',
                    cols === n
                      ? 'bg-violet-100 dark:bg-violet-900/40 text-violet-600'
                      : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 휴지통 선택 바 */}
      {isTrash && memos.length > 0 && (
        <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900">
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <input
              ref={selectAllRef}
              type="checkbox"
              checked={selectedTrashIds.size > 0 && selectedTrashIds.size === memos.length}
              onChange={() => {
                if (selectedTrashIds.size === memos.length) deselectAllTrash()
                else selectAllTrash()
              }}
              className="w-3.5 h-3.5 accent-violet-600 cursor-pointer"
            />
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {selectedTrashIds.size > 0 ? `${selectedTrashIds.size}개 선택됨` : '전체 선택'}
            </span>
          </label>
          {selectedTrashIds.size > 0 && (
            <button
              onClick={handleBulkRestore}
              className="ml-auto flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-950/20 rounded-lg transition-colors"
            >
              <RotateCcw size={12} /> 선택 복원
            </button>
          )}
        </div>
      )}

      {/* 정렬 필터 + 태그 드롭다운 */}
      {!isTrash && (
        <div className="flex items-center gap-1.5 px-4 py-2 border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900">
          {/* 정렬·월 칩: 가로 스크롤 (overflow-x-auto) */}
          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none flex-1 min-w-0">
            {SORT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setSort(opt.value)}
                className={cn(
                  'flex-shrink-0 text-xs px-2.5 py-1 rounded-full border transition-colors',
                  sort === opt.value
                    ? 'border-violet-500 bg-violet-50 dark:bg-violet-950/30 text-violet-600 dark:text-violet-400'
                    : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300'
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {/* 태그 드롭다운: overflow 스크롤 영역 밖에 배치해야 dropdown이 clip되지 않음 */}
          <TagDropdown
            allTags={allTags}
            selectedTag={activeTag}
            onSelect={setActiveTag}
          />
        </div>
      )}

      {/* 타임라인 필터 */}
      {view === 'timeline' && !isTrash && (
        <TimelineFilter
          startDate={tlStartDate}
          endDate={tlEndDate}
          onDateRangeApply={(s, e) => { setTlStartDate(s); setTlEndDate(e); setTlMonth(null) }}
          allMonths={tlAllMonths}
          activeMonth={tlMonth}
          onMonthChange={(m) => { setTlMonth(m); setTlStartDate(null); setTlEndDate(null) }}
          onClearFilter={() => { setTlStartDate(null); setTlEndDate(null); setTlMonth(null) }}
        />
      )}

      {/* 메모 목록 */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <MemoListSkeleton />
        ) : memos.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-gray-400">
            <p className="text-sm">{isTrash ? '휴지통이 비어 있습니다' : '메모가 없습니다'}</p>
            {!isTrash && (
              <button onClick={() => router.push(selectedFolderId ? `/memo/new?folder=${selectedFolderId}` : '/memo/new')} className="text-xs text-violet-500 hover:text-violet-700 underline">
                첫 메모 만들기
              </button>
            )}
          </div>
        ) : isTrash ? (
          <div className={view === 'card' ? 'p-4' : ''}>
            <MemoSection
              memos={filtered.all.slice(0, displayCount)}
              view={view === 'timeline' ? 'list' : view}
              isTrash
              selectedTrashIds={selectedTrashIds}
              onToggleSelect={toggleTrashSelect}
              {...cardActions}
            />
            {filtered.all.length > displayCount && <div ref={sentinelRef} className="h-8" />}
          </div>
        ) : view === 'timeline' ? (
          /* 타임라인 뷰 */
          <div className="p-4 space-y-6">
            {timelineGroups.length === 0 ? (
              <div className="text-center text-sm text-gray-400 py-12">해당 기간에 메모가 없습니다</div>
            ) : timelineGroups.map(({ monthLabel, days }) => (
              <div key={monthLabel}>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xs font-bold text-gray-600 dark:text-gray-400">{monthLabel}</span>
                  <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
                </div>
                <div className="space-y-4 ml-1">
                  {days.map(({ dayLabel, memos: dayMemos }) => (
                    <div key={dayLabel}>
                      <p className="text-xs text-gray-400 dark:text-gray-500 font-medium mb-1 pl-1">{dayLabel}</p>
                      <div className="space-y-0.5">
                        {dayMemos.map((m) => <MemoCard key={m.id} memo={m} view="list" {...cardActions} />)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* 카드/리스트 뷰 */
          <div className={view === 'card' ? 'p-4' : ''}>
            {filtered.pinned.length > 0 && (
              <>
                {view === 'card' && <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">고정됨</p>}
                <MemoSection memos={filtered.pinned.slice(0, displayCount)} view={view} cols={cols} {...cardActions} />
                {filtered.rest.length > 0 && view === 'card' && (
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mt-4 mb-2">메모</p>
                )}
              </>
            )}
            <MemoSection memos={filtered.rest.slice(0, Math.max(0, displayCount - filtered.pinned.length))} view={view} cols={cols} {...cardActions} />
            {(filtered.pinned.length + filtered.rest.length) > displayCount && (
              <div ref={sentinelRef} className="h-8" />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function TagDropdown({
  allTags,
  selectedTag,
  onSelect,
}: {
  allTags: string[]
  selectedTag: string | null
  onSelect: (tag: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setSearch('')
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const filtered = useMemo(
    () => allTags.filter((t) => t.toLowerCase().includes(search.toLowerCase())),
    [allTags, search]
  )

  function handleSelect(tag: string | null) {
    onSelect(tag)
    setOpen(false)
    setSearch('')
  }

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border transition-colors',
          selectedTag
            ? 'border-cyan-500 bg-cyan-50 dark:bg-cyan-950/30 text-cyan-600 dark:text-cyan-400'
            : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300'
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

      {open && (
        <div className="absolute top-[calc(100%+6px)] left-0 z-50 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg min-w-[200px] max-h-80 overflow-hidden flex flex-col">
          {/* 검색창 */}
          <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-800">
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') { setOpen(false); setSearch('') } }}
              placeholder="태그 검색..."
              className="w-full text-xs bg-transparent outline-none text-gray-700 dark:text-gray-300 placeholder-gray-400"
            />
          </div>

          {/* 태그 목록 */}
          <div className="overflow-y-auto">
            <div
              onClick={() => handleSelect(null)}
              className={cn(
                'flex items-center gap-2 px-3.5 py-2 text-xs cursor-pointer transition-colors',
                !selectedTag
                  ? 'bg-cyan-50 dark:bg-cyan-950/20 text-cyan-600 dark:text-cyan-400 font-medium'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
              )}
            >
              {!selectedTag && <span>✓</span>}
              <span>전체</span>
            </div>

            {filtered.length === 0 ? (
              <div className="px-3.5 py-3 text-xs text-gray-400 text-center">태그가 없어요</div>
            ) : (
              filtered.map((tag) => (
                <div
                  key={tag}
                  onClick={() => handleSelect(tag)}
                  className={cn(
                    'flex items-center gap-2 px-3.5 py-2 text-xs cursor-pointer transition-colors',
                    selectedTag === tag
                      ? 'bg-cyan-50 dark:bg-cyan-950/20 text-cyan-600 dark:text-cyan-400 font-medium'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                  )}
                >
                  {selectedTag === tag && <span>✓</span>}
                  <span>{tag}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function MemoSection({ memos, view, cols = 4, isTrash = false, onPin, onStar, onDelete, onLock, onUnlock, onRestore, onPermanentDelete, onMoveToFolder, selectedTrashIds, onToggleSelect }: {
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
}) {
  const props = { view, isTrash, onPin, onStar, onDelete, onLock, onUnlock, onRestore, onPermanentDelete, onMoveToFolder, onToggleSelect }
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
