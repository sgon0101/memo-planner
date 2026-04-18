'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, LayoutGrid, List, AlignLeft, Search, Trash2 } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { ko } from 'date-fns/locale'
import { cn } from '@/lib/utils'
import { useFolderStore } from '@/store/folderStore'
import { useMemos, TRASH_ID } from '@/hooks/useMemos'
import MemoCard from './MemoCard'

type SortKey = 'updated' | 'created' | 'title' | 'starred' | 'pinned'
type ViewMode = 'card' | 'list' | 'timeline'

export default function MemoList() {
  const router = useRouter()
  const { selectedFolderId, folders } = useFolderStore()
  const {
    memos, isTrash,
    createMemo, togglePin, toggleStar, softDelete,
    lockMemo, unlockMemo,
    restoreMemo, permanentDelete, emptyTrash,
  } = useMemos(selectedFolderId)

  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortKey>('updated')
  const [view, setView] = useState<ViewMode>('card')
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [activeMonth, setActiveMonth] = useState<string | null>(null)

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

  // 월별 목록 수집 (최신순)
  const allMonths = useMemo(() => {
    const set = new Set<string>()
    memos.forEach((m) => set.add(m.updatedAt.slice(0, 7)))
    return Array.from(set).sort().reverse()
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

    if (activeMonth) {
      list = list.filter((m) => m.updatedAt.startsWith(activeMonth))
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
  }, [memos, search, sort, isTrash, activeTag, activeMonth])

  // 타임라인: 날짜별 그룹핑
  const timelineGroups = useMemo(() => {
    const groups: { label: string; memos: typeof memos }[] = []
    const map = new Map<string, typeof memos>()
    filtered.all.forEach((m) => {
      const key = format(parseISO(m.updatedAt), 'yyyy년 M월', { locale: ko })
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(m)
    })
    map.forEach((ms, label) => groups.push({ label, memos: ms }))
    return groups
  }, [filtered.all])

  const cardActions = {
    onPin: (id: string, cur: boolean) => togglePin(id, cur).catch(console.error),
    onStar: (id: string, cur: boolean) => toggleStar(id, cur).catch(console.error),
    onDelete: (id: string) => softDelete(id).catch(console.error),
    onLock: (id: string, content: Record<string, unknown>, pw: string) => lockMemo(id, content, pw),
    onUnlock: (id: string, locked: string, pw: string) => unlockMemo(id, locked, pw),
    onRestore: (id: string) => restoreMemo(id).catch(console.error),
    onPermanentDelete: (id: string) => permanentDelete(id).catch(console.error),
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
        ) : (
          <button
            onClick={() => router.push('/memo/new')}
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
      </div>

      {/* 정렬 필터 + 태그 칩 */}
      {!isTrash && (
        <div className="flex items-center gap-1.5 px-4 py-2 border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-x-auto scrollbar-none">
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
          {allTags.map((tag) => (
            <button
              key={tag}
              onClick={() => setActiveTag(activeTag === tag ? null : tag)}
              className={cn(
                'flex-shrink-0 text-xs px-2.5 py-1 rounded-full border transition-colors',
                activeTag === tag
                  ? 'border-cyan-500 bg-cyan-50 dark:bg-cyan-950/30 text-cyan-600 dark:text-cyan-400'
                  : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300'
              )}
            >
              #{tag}
            </button>
          ))}
          {allMonths.length > 1 && allMonths.map((month) => (
            <button
              key={month}
              onClick={() => setActiveMonth(activeMonth === month ? null : month)}
              className={cn(
                'flex-shrink-0 text-xs px-2.5 py-1 rounded-full border transition-colors',
                activeMonth === month
                  ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400'
                  : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300'
              )}
            >
              {month.replace('-', '.')}
            </button>
          ))}
        </div>
      )}

      {/* 메모 목록 */}
      <div className="flex-1 overflow-y-auto">
        {memos.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-gray-400">
            <p className="text-sm">{isTrash ? '휴지통이 비어 있습니다' : '메모가 없습니다'}</p>
            {!isTrash && (
              <button onClick={() => router.push('/memo/new')} className="text-xs text-violet-500 hover:text-violet-700 underline">
                첫 메모 만들기
              </button>
            )}
          </div>
        ) : isTrash ? (
          <div className={view === 'card' ? 'p-4' : ''}>
            <MemoSection memos={filtered.all} view={view === 'timeline' ? 'list' : view} isTrash {...cardActions} />
          </div>
        ) : view === 'timeline' ? (
          /* 타임라인 뷰 */
          <div className="p-4 space-y-6">
            {timelineGroups.map(({ label, memos: gMemos }) => (
              <div key={label}>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">{label}</span>
                  <div className="flex-1 h-px bg-gray-200 dark:bg-gray-800" />
                  <span className="text-xs text-gray-400">{gMemos.length}개</span>
                </div>
                <div className="space-y-1">
                  {gMemos.map((m) => <MemoCard key={m.id} memo={m} view="list" {...cardActions} />)}
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
                <MemoSection memos={filtered.pinned} view={view} {...cardActions} />
                {filtered.rest.length > 0 && view === 'card' && (
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mt-4 mb-2">메모</p>
                )}
              </>
            )}
            <MemoSection memos={filtered.rest} view={view} {...cardActions} />
          </div>
        )}
      </div>
    </div>
  )
}

function MemoSection({ memos, view, isTrash = false, onPin, onStar, onDelete, onLock, onUnlock, onRestore, onPermanentDelete }: {
  memos: ReturnType<typeof useMemos>['memos']
  view: 'card' | 'list'
  isTrash?: boolean
  onPin: (id: string, cur: boolean) => void
  onStar: (id: string, cur: boolean) => void
  onDelete: (id: string) => void
  onLock: (id: string, content: Record<string, unknown>, pw: string) => Promise<void>
  onUnlock: (id: string, locked: string, pw: string) => Promise<void>
  onRestore: (id: string) => void
  onPermanentDelete: (id: string) => void
}) {
  const props = { view, isTrash, onPin, onStar, onDelete, onLock, onUnlock, onRestore, onPermanentDelete }
  if (view === 'card') {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {memos.map((m) => <MemoCard key={m.id} memo={m} {...props} />)}
      </div>
    )
  }
  return (
    <div>{memos.map((m) => <MemoCard key={m.id} memo={m} {...props} />)}</div>
  )
}
