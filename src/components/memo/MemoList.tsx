'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, LayoutGrid, List, Search, SortDesc } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useFolderStore } from '@/store/folderStore'
import { useMemos } from '@/hooks/useMemos'
import MemoCard from './MemoCard'

type SortKey = 'updated' | 'created' | 'title'
type ViewMode = 'card' | 'list'

export default function MemoList() {
  const router = useRouter()
  const { selectedFolderId, folders } = useFolderStore()
  const { memos, createMemo, togglePin, toggleStar, softDelete, lockMemo, unlockMemo } = useMemos(selectedFolderId)

  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<SortKey>('updated')
  const [view, setView] = useState<ViewMode>('card')

  const folderName = selectedFolderId
    ? folders.find((f) => f.id === selectedFolderId)?.name ?? '폴더'
    : '전체 메모'

  const filtered = useMemo(() => {
    let list = search
      ? memos.filter((m) =>
          m.title.toLowerCase().includes(search.toLowerCase()) ||
          m.contentText.toLowerCase().includes(search.toLowerCase())
        )
      : [...memos]

    list.sort((a, b) => {
      if (sort === 'title') return a.title.localeCompare(b.title, 'ko')
      if (sort === 'created') return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    })

    // 고정 메모를 맨 앞으로
    const pinned = list.filter((m) => m.isPinned)
    const rest = list.filter((m) => !m.isPinned)
    return { pinned, rest }
  }, [memos, search, sort])

  async function handleNew() {
    router.push('/memo/new')
  }

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-950">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">{folderName}</h2>
        <button
          onClick={handleNew}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white text-xs font-medium rounded-lg transition-colors"
        >
          <Plus size={13} /> 새 메모
        </button>
      </div>

      {/* 검색 + 뷰 컨트롤 */}
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

        {/* 정렬 */}
        <div className="flex items-center gap-1">
          <SortDesc size={13} className="text-gray-400" />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="text-xs text-gray-600 dark:text-gray-400 bg-transparent outline-none cursor-pointer"
          >
            <option value="updated">최근 수정</option>
            <option value="created">최근 생성</option>
            <option value="title">이름순</option>
          </select>
        </div>

        {/* 뷰 토글 */}
        <div className="flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          <button
            onClick={() => setView('card')}
            className={cn('p-1.5 transition-colors', view === 'card' ? 'bg-violet-100 dark:bg-violet-900/40 text-violet-600' : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800')}
          >
            <LayoutGrid size={13} />
          </button>
          <button
            onClick={() => setView('list')}
            className={cn('p-1.5 transition-colors', view === 'list' ? 'bg-violet-100 dark:bg-violet-900/40 text-violet-600' : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800')}
          >
            <List size={13} />
          </button>
        </div>
      </div>

      {/* 메모 목록 */}
      <div className="flex-1 overflow-y-auto">
        {memos.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-400">
            <p className="text-sm">메모가 없습니다</p>
            <button
              onClick={handleNew}
              className="text-xs text-violet-500 hover:text-violet-700 underline"
            >
              첫 메모 만들기
            </button>
          </div>
        ) : (
          <div className={view === 'card' ? 'p-4' : ''}>
            {/* 고정 메모 */}
            {filtered.pinned.length > 0 && (
              <>
                {view === 'card' && (
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">고정됨</p>
                )}
                <MemoSection memos={filtered.pinned} view={view} {...cardProps()} />
                {filtered.rest.length > 0 && view === 'card' && (
                  <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mt-4 mb-2">메모</p>
                )}
              </>
            )}
            {/* 일반 메모 */}
            <MemoSection memos={filtered.rest} view={view} {...cardProps()} />
          </div>
        )}
      </div>
    </div>
  )

  function cardProps() {
    return {
      onPin: (id: string, cur: boolean) => togglePin(id, cur).catch(console.error),
      onStar: (id: string, cur: boolean) => toggleStar(id, cur).catch(console.error),
      onDelete: (id: string) => softDelete(id).catch(console.error),
      onLock: (id: string, content: Record<string, unknown>, pw: string) => lockMemo(id, content, pw),
      onUnlock: (id: string, locked: string, pw: string) => unlockMemo(id, locked, pw),
    }
  }
}

function MemoSection({ memos, view, onPin, onStar, onDelete, onLock, onUnlock }: {
  memos: ReturnType<typeof useMemos>['memos']
  view: ViewMode
  onPin: (id: string, cur: boolean) => void
  onStar: (id: string, cur: boolean) => void
  onDelete: (id: string) => void
  onLock: (id: string, content: Record<string, unknown>, pw: string) => Promise<void>
  onUnlock: (id: string, locked: string, pw: string) => Promise<void>
}) {
  if (view === 'card') {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {memos.map((m) => (
          <MemoCard key={m.id} memo={m} view="card"
            onPin={onPin} onStar={onStar} onDelete={onDelete} onLock={onLock} onUnlock={onUnlock} />
        ))}
      </div>
    )
  }
  return (
    <div>
      {memos.map((m) => (
        <MemoCard key={m.id} memo={m} view="list"
          onPin={onPin} onStar={onStar} onDelete={onDelete} onLock={onLock} onUnlock={onUnlock} />
      ))}
    </div>
  )
}
