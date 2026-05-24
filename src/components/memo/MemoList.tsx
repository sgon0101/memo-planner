'use client'

import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, LayoutGrid, List, AlignLeft, Search, Trash2, RotateCcw, ChevronDown, ChevronRight, Folder, MoreHorizontal, Pencil, Palette } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { ko } from 'date-fns/locale'
import { cn } from '@/lib/utils'
import { useFolderStore } from '@/store/folderStore'
import { useFolders } from '@/hooks/useFolders'
import { createClient } from '@/lib/supabase/client'
import type { Folder as FolderType } from '@/types'
import { useMemos, TRASH_ID } from '@/hooks/useMemos'
import { useMemoSearch } from '@/hooks/useMemoSearch'
import { MemoListSkeleton } from '@/components/ui/Skeleton'
import MemoCard from './MemoCard'
import ColorWheelModal from './ColorWheelModal'
import TimelineFilter from './TimelineFilter'

const PAGE_SIZE = 20

type SortKey = 'updated' | 'created' | 'title' | 'starred' | 'pinned'

type TitleDir = 'asc' | 'desc'
type ViewMode = 'card' | 'list' | 'timeline'

export default function MemoList() {
  const router = useRouter()
  const { selectedFolderId, folders, selectFolder } = useFolderStore()
  const { createFolder, renameFolder, updateColor, removeFolder, reorderFolder, nestFolder } = useFolders()
  const [showFolderDropdown, setShowFolderDropdown] = useState(false)
  const folderDropdownRef = useRef<HTMLDivElement>(null)
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())
  const [showNewFolderModal, setShowNewFolderModal] = useState(false)
  const [menu, setMenu] = useState<{ folderId: string } | null>(null)
  const [colorTarget, setColorTarget] = useState<FolderType | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [newFolderParentId, setNewFolderParentId] = useState<string | null>(null)
  const editInputRef = useRef<HTMLInputElement | null>(null)

  // 모바일 폴더 touch DnD 상태
  const [touchDragId, setTouchDragId] = useState<string | null>(null)
  const [touchDropId, setTouchDropId] = useState<string | null>(null)
  const [touchDropPos, setTouchDropPos] = useState<'before' | 'inside' | 'after' | null>(null)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const touchOrigin = useRef<{ x: number; y: number } | null>(null)
  const {
    memos, isLoading, isFetching, isTrash,
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

  // 모바일 폴더 드롭다운 — 외부 클릭 닫힘
  useEffect(() => {
    if (!showFolderDropdown) return
    // 다른 모달이나 inline edit 활성 시 외부 클릭 감지 비활성 (드롭다운 유지)
    if (menu || colorTarget || showNewFolderModal || editingId) return
    function handleOutside(e: MouseEvent) {
      if (folderDropdownRef.current && !folderDropdownRef.current.contains(e.target as Node)) {
        setShowFolderDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [showFolderDropdown, menu, colorTarget, showNewFolderModal, editingId])

  // ESC 우선순위: 컨텍스트 메뉴 → 색상 모달 → 새 폴더 모달 → 폴더 드롭다운
  // inline edit(editingId)은 input onKeyDown에서 처리되므로 여기선 무시
  useEffect(() => {
    function handleEsc(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (editingId) return
      if (menu) { setMenu(null); return }
      if (colorTarget) { setColorTarget(null); return }
      if (showNewFolderModal) { setShowNewFolderModal(false); return }
      if (showFolderDropdown) { setShowFolderDropdown(false); return }
    }
    document.addEventListener('keydown', handleEsc)
    return () => document.removeEventListener('keydown', handleEsc)
  }, [showFolderDropdown, menu, colorTarget, showNewFolderModal, editingId])

  // 드래그 중 스크롤 방지 (non-passive touchmove)
  useEffect(() => {
    if (!touchDragId) return
    function prevent(e: TouchEvent) { e.preventDefault() }
    document.addEventListener('touchmove', prevent, { passive: false })
    return () => document.removeEventListener('touchmove', prevent)
  }, [touchDragId])

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
  const [titleDir, setTitleDir] = useState<TitleDir>('asc')
  const [view, setView] = useState<ViewMode>('card')
  const [activeTag, setActiveTag] = useState<string | null>(null)

  // 검색 input — 반응형 placeholder + 포커스 시 도움 칩
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const [searchPlaceholder, setSearchPlaceholder] = useState('메모 검색')
  const [searchFocused, setSearchFocused] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 640px)')
    function update() {
      setSearchPlaceholder(mq.matches
        ? '메모 검색  ·  공백으로 여러 단어 검색 가능'
        : '메모 검색'
      )
    }
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  function insertSearchPrefix(prefix: string) {
    setSearch(prefix)
    requestAnimationFrame(() => {
      const el = searchInputRef.current
      if (el) {
        el.focus()
        el.setSelectionRange(prefix.length, prefix.length)
      }
    })
  }

  // 검색/정렬/태그 변경 시 표시 개수 초기화 (검색 필터가 항상 우선 적용)
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setDisplayCount(PAGE_SIZE) }, [search, sort, titleDir, activeTag])

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

  // #9 — Postgres FTS 서버 검색 (debounce 300ms)
  // 검색어 있으면 서버 결과, 비면 기존 memos (폴더/페이지 기반)
  const {
    results: searchResults,
    isSearching,
    isFetching: searchFetching,
  } = useMemoSearch({
    query: search,
    folderId: isTrash ? 'trash' : selectedFolderId,
  })

  const filtered = useMemo(() => {
    // 검색 중이면 서버 결과를 베이스로, 아니면 기존 폴더별 memos
    let list = isSearching ? [...(searchResults ?? [])] : [...memos]

    if (activeTag) {
      list = list.filter((m) => m.tags?.includes(activeTag))
    }

    if (!isTrash) {
      list.sort((a, b) => {
        if (sort === 'title') return titleDir === 'asc'
          ? a.title.localeCompare(b.title, 'ko')
          : b.title.localeCompare(a.title, 'ko')
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
  }, [memos, searchResults, isSearching, sort, titleDir, isTrash, activeTag])

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

  function toggleFolderExpand(parentId: string) {
    setExpandedFolders((prev) => {
      const next = new Set(prev)
      if (next.has(parentId)) next.delete(parentId)
      else next.add(parentId)
      return next
    })
  }

  async function handleNewFolderConfirm(h: number, s: number, l: number, name?: string) {
    setShowNewFolderModal(false)
    if (!name?.trim()) return
    try {
      const folder = await createFolder(name.trim(), newFolderParentId)
      if (h !== 260 || s !== 60 || l !== 80) {
        await updateColor(folder.id, h, s, l).catch(console.error)
      }
      if (newFolderParentId) {
        setExpandedFolders((prev) => new Set([...prev, newFolderParentId as string]))
      }
    } catch (e) { console.error(e) }
  }

  function openMenu(folderId: string) {
    setMenu({ folderId })
  }

  function startEdit(folderId: string, currentName: string) {
    setEditingId(folderId)
    setEditValue(currentName)
    setMenu(null)
    setTimeout(() => editInputRef.current?.focus(), 50)
  }

  async function commitEdit(id: string) {
    const original = folders.find((f) => f.id === id)?.name ?? ''
    if (editValue.trim() && editValue.trim() !== original) {
      await renameFolder(id, editValue.trim()).catch(console.error)
    }
    setEditingId(null)
  }

  function cancelEdit() { setEditingId(null) }

  // 모바일 폴더 touch DnD 핸들러
  function onFolderTouchStart(e: React.TouchEvent, folderId: string) {
    const t = e.touches[0]
    touchOrigin.current = { x: t.clientX, y: t.clientY }
    longPressTimer.current = setTimeout(() => {
      setTouchDragId(folderId)
      navigator.vibrate?.(50)
    }, 500)
  }

  function onFolderTouchMove(e: React.TouchEvent) {
    if (!touchOrigin.current) return
    const t = e.touches[0]

    if (!touchDragId) {
      // 500ms 전 — 8px 이상 이동 시 long-press 취소 (스크롤 허용)
      const dx = t.clientX - touchOrigin.current.x
      const dy = t.clientY - touchOrigin.current.y
      if (Math.sqrt(dx * dx + dy * dy) > 8) {
        if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null }
      }
      return
    }

    // 드래그 중 — 드롭 대상 탐색
    const el = document.elementFromPoint(t.clientX, t.clientY) as HTMLElement | null
    const row = el?.closest('[data-fdrag]') as HTMLElement | null
    const targetId = row?.getAttribute('data-fdrag')

    if (targetId && targetId !== touchDragId) {
      const rect = row!.getBoundingClientRect()
      const relY = t.clientY - rect.top
      const h = rect.height || 1
      const pos: 'before' | 'inside' | 'after' =
        relY < h * 0.3 ? 'before' : relY > h * 0.7 ? 'after' : 'inside'
      setTouchDropId(targetId)
      setTouchDropPos(pos)
    } else {
      setTouchDropId(null)
      setTouchDropPos(null)
    }
  }

  async function onFolderTouchEnd() {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null }
    touchOrigin.current = null

    const dragId = touchDragId
    const dropId = touchDropId
    const pos = touchDropPos

    setTouchDragId(null)
    setTouchDropId(null)
    setTouchDropPos(null)

    if (!dragId || !dropId || !pos || dragId === dropId) return

    if (pos === 'inside') {
      await nestFolder(dragId, dropId).catch(console.error)
      setExpandedFolders((prev) => new Set([...prev, dropId]))
    } else {
      await reorderFolder(dragId, dropId, pos).catch(console.error)
    }
  }

  async function handleDelete(id: string) {
    setMenu(null)
    const supabase = createClient()
    const { count } = await supabase
      .from('memos')
      .select('id', { count: 'exact' })
      .eq('folder_id', id)
      .eq('is_deleted', false)
    const folderName = folders.find((f) => f.id === id)?.name ?? '폴더'
    const msg = count && count > 0
      ? `"${folderName}" 폴더를 삭제하면\n안에 있는 메모 ${count}개도 휴지통으로 이동해요.\n\n계속하시겠어요?`
      : `"${folderName}" 폴더를 삭제할까요?`
    if (!confirm(msg)) return
    await removeFolder(id).catch(console.error)
    if (selectedFolderId === id) selectFolder(null)
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
    { value: 'starred', label: '중요먼저' },
    { value: 'pinned', label: '고정먼저' },
  ]

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-950">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        {/* 데스크톱: 폴더명 텍스트 */}
        <h2 className={cn('hidden sm:block text-sm font-semibold', isTrash ? 'text-red-500' : 'text-gray-800 dark:text-gray-200')}>
          {folderName}
        </h2>

        {/* 모바일: 커스텀 폴더 선택 드롭다운 */}
        <div ref={folderDropdownRef} className="relative sm:hidden">
          <button
            onClick={() => setShowFolderDropdown((v) => !v)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            {/* 트리거: 현재 선택 상태 표시 */}
            {isTrash ? (
              <Trash2 size={12} className="text-red-500" />
            ) : selectedFolderId ? (
              <span
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ background: `hsl(${folders.find((f) => f.id === selectedFolderId)?.colorH ?? 260}, ${folders.find((f) => f.id === selectedFolderId)?.colorS ?? 60}%, ${folders.find((f) => f.id === selectedFolderId)?.colorL ?? 80}%)` }}
              />
            ) : (
              <Folder size={12} className="text-gray-400" />
            )}
            <span className={isTrash ? 'text-red-500' : ''}>{folderName}</span>
            <ChevronDown size={11} className={cn('text-gray-400 transition-transform', showFolderDropdown && 'rotate-180')} />
          </button>

          {showFolderDropdown && (
            <>
              {/* 드롭다운 패널 */}
              <div className="absolute left-0 top-full mt-1 z-50 min-w-44 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg py-1 overflow-hidden">
                {/* 전체 메모 */}
                <button
                  onClick={() => { selectFolder(null); setShowFolderDropdown(false) }}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors',
                    !selectedFolderId && !isTrash
                      ? 'bg-violet-50 dark:bg-violet-950/20 text-violet-600 dark:text-violet-400 font-medium'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                  )}
                >
                  <Folder size={12} className="text-gray-400 flex-shrink-0" />
                  전체 메모
                </button>

                {/* + 새 폴더 */}
                <button
                  onClick={() => { setShowFolderDropdown(false); setNewFolderParentId(null); setShowNewFolderModal(true) }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-950/20 transition-colors"
                >
                  <Plus size={12} className="flex-shrink-0" />
                  새 폴더
                </button>

                {/* 휴지통 */}
                <button
                  onClick={() => { selectFolder(TRASH_ID); setShowFolderDropdown(false) }}
                  className={cn(
                    'w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors',
                    isTrash
                      ? 'bg-red-50 dark:bg-red-950/20 text-red-500 font-medium'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                  )}
                >
                  <Trash2 size={12} className="text-red-400 flex-shrink-0" />
                  휴지통
                </button>

                {/* 구분선 */}
                {folders.length > 0 && (
                  <div className="my-1 border-t border-gray-100 dark:border-gray-800" />
                )}

                {/* 폴더 목록 — Accordion + touch DnD */}
                {folders
                  .filter((f) => !f.parentId)
                  .sort((a, b) => a.orderIndex - b.orderIndex)
                  .map((parent) => {
                    const children = folders
                      .filter((f) => f.parentId === parent.id)
                      .sort((a, b) => a.orderIndex - b.orderIndex)
                    const hasChildren = children.length > 0
                    const isExpanded = expandedFolders.has(parent.id)
                    const isDragging = touchDragId === parent.id
                    const isDropBefore = touchDropId === parent.id && touchDropPos === 'before'
                    const isDropInside = touchDropId === parent.id && touchDropPos === 'inside'
                    const isDropAfter  = touchDropId === parent.id && touchDropPos === 'after'
                    return (
                      <div key={parent.id}>
                        {/* before 인디케이터 */}
                        {isDropBefore && <div className="h-0.5 bg-violet-500 rounded mx-2 mb-0.5" />}

                        {/* 부모 폴더 행 */}
                        <div
                          data-fdrag={parent.id}
                          onTouchStart={(e) => onFolderTouchStart(e, parent.id)}
                          onTouchMove={onFolderTouchMove}
                          onTouchEnd={onFolderTouchEnd}
                          className={cn(
                            'w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors',
                            isDragging && 'opacity-40',
                            isDropInside
                              ? 'ring-1 ring-violet-500 bg-violet-50 dark:bg-violet-950/20 text-violet-600 dark:text-violet-400'
                              : selectedFolderId === parent.id && !isTrash
                                ? 'bg-violet-50 dark:bg-violet-950/20 text-violet-600 dark:text-violet-400 font-medium'
                                : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                          )}>
                          {/* 화살표: 자식 있을 때만 */}
                          <button
                            onClick={(e) => { e.stopPropagation(); toggleFolderExpand(parent.id) }}
                            className={cn('flex-shrink-0 transition-transform', !hasChildren && 'invisible')}
                          >
                            <ChevronRight size={11} className={cn(isExpanded && 'rotate-90')} />
                          </button>
                          {/* 폴더명: inline edit 또는 클릭 시 폴더 선택 */}
                          {editingId === parent.id ? (
                            <div className="flex-1 flex items-center gap-2 pl-1">
                              <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: `hsl(${parent.colorH}, ${parent.colorS}%, ${parent.colorL}%)` }} />
                              <input
                                ref={editInputRef}
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                onBlur={() => commitEdit(parent.id)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') { e.preventDefault(); void commitEdit(parent.id) }
                                  if (e.key === 'Escape') { e.preventDefault(); cancelEdit() }
                                }}
                                className="flex-1 bg-transparent outline-none text-xs border-b border-violet-400"
                                onClick={(e) => e.stopPropagation()}
                              />
                            </div>
                          ) : (
                            <>
                              <button
                                onClick={() => { selectFolder(parent.id); setShowFolderDropdown(false) }}
                                className="flex items-center gap-2 flex-1 text-left min-w-0"
                              >
                                <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: `hsl(${parent.colorH}, ${parent.colorS}%, ${parent.colorL}%)` }} />
                                <span className="truncate">{parent.name}</span>
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); openMenu(parent.id) }}
                                className="flex-shrink-0 p-1 mr-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400 transition-colors"
                              >
                                <MoreHorizontal size={14} />
                              </button>
                            </>
                          )}
                        </div>

                        {/* after 인디케이터 */}
                        {isDropAfter && <div className="h-0.5 bg-violet-500 rounded mx-2 mt-0.5" />}

                        {/* 서브폴더 */}
                        {isExpanded && children.map((child) => {
                          const cIsDragging  = touchDragId === child.id
                          const cDropBefore  = touchDropId === child.id && touchDropPos === 'before'
                          const cDropInside  = touchDropId === child.id && touchDropPos === 'inside'
                          const cDropAfter   = touchDropId === child.id && touchDropPos === 'after'
                          return (
                            <div key={child.id}>
                              {cDropBefore && <div className="h-0.5 bg-violet-500 rounded mx-2 mb-0.5" />}
                              <div
                                data-fdrag={child.id}
                                onTouchStart={(e) => onFolderTouchStart(e, child.id)}
                                onTouchMove={onFolderTouchMove}
                                onTouchEnd={onFolderTouchEnd}
                                className={cn(
                                  'w-full flex items-center gap-2 pl-9 py-2 text-xs transition-colors',
                                  cIsDragging && 'opacity-40',
                                  cDropInside
                                    ? 'ring-1 ring-violet-500 bg-violet-50 dark:bg-violet-950/20 text-violet-600 dark:text-violet-400'
                                    : selectedFolderId === child.id && !isTrash
                                      ? 'bg-violet-50 dark:bg-violet-950/20 text-violet-600 dark:text-violet-400 font-medium'
                                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                                )}
                              >
                                {editingId === child.id ? (
                                  <div className="flex-1 flex items-center gap-2">
                                    <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: `hsl(${child.colorH}, ${child.colorS}%, ${child.colorL}%)` }} />
                                    <input
                                      ref={editInputRef}
                                      value={editValue}
                                      onChange={(e) => setEditValue(e.target.value)}
                                      onBlur={() => commitEdit(child.id)}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') { e.preventDefault(); void commitEdit(child.id) }
                                        if (e.key === 'Escape') { e.preventDefault(); cancelEdit() }
                                      }}
                                      className="flex-1 bg-transparent outline-none text-xs border-b border-violet-400"
                                      onClick={(e) => e.stopPropagation()}
                                    />
                                  </div>
                                ) : (
                                  <>
                                    <button
                                      onClick={() => { selectFolder(child.id); setShowFolderDropdown(false) }}
                                      className="flex items-center gap-2 flex-1 text-left min-w-0"
                                    >
                                      <span className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: `hsl(${child.colorH}, ${child.colorS}%, ${child.colorL}%)` }} />
                                      <span className="truncate">{child.name}</span>
                                    </button>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); openMenu(child.id) }}
                                      className="flex-shrink-0 p-1 mr-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400 transition-colors"
                                    >
                                      <MoreHorizontal size={14} />
                                    </button>
                                  </>
                                )}
                              </div>
                              {cDropAfter && <div className="h-0.5 bg-violet-500 rounded mx-2 mt-0.5" />}
                            </div>
                          )
                        })}
                      </div>
                    )
                  })}
              </div>
            </>
          )}
        </div>
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
          <Search
            size={13}
            className={cn(
              'absolute left-2.5 top-1/2 -translate-y-1/2 transition-colors',
              searchFetching ? 'text-violet-500 animate-pulse' : 'text-gray-400',
            )}
          />
          <input
            ref={searchInputRef}
            data-shortcut="search"
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            // 칩의 onMouseDown 처리(preventDefault) 후 blur가 발생하므로 약간 지연
            onBlur={() => setTimeout(() => setSearchFocused(false), 200)}
            placeholder={searchPlaceholder}
            className="w-full pl-8 pr-9 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 outline-none focus:ring-1 focus:ring-violet-400"
          />
          {/* 데스크탑 — '/' 단축키 안내 */}
          <kbd className="hidden sm:flex absolute right-2 top-1/2 -translate-y-1/2 items-center justify-center w-5 h-5 text-[10px] font-mono text-gray-400 bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-700 rounded pointer-events-none">
            /
          </kbd>
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
            <div className="hidden sm:flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
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

      {/* 검색 도움 칩 — 포커스 + 빈 입력일 때만 */}
      {searchFocused && !search.trim() && (
        <div className="flex items-center gap-1.5 px-4 py-2 border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-x-auto">
          <span className="flex-shrink-0 text-[10px] text-gray-400 dark:text-gray-500 mr-1">검색 팁:</span>
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); insertSearchPrefix('#') }}
            className="flex-shrink-0 text-[11px] px-2 py-0.5 rounded-full border border-blue-200 dark:border-blue-900/50 text-blue-500 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors cursor-pointer"
          >
            # 태그로 검색
          </button>
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); insertSearchPrefix('[[') }}
            className="flex-shrink-0 text-[11px] px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-900/50 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-colors cursor-pointer"
          >
            [[ 위키링크로 검색
          </button>
          <span className="flex-shrink-0 text-[11px] px-2 py-0.5 rounded-full bg-gray-50 dark:bg-gray-800/50 text-gray-500 dark:text-gray-400 border border-dashed border-gray-200 dark:border-gray-700">
            공백 = 여러 단어 모두 포함
          </span>
        </div>
      )}

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

      {/* 정렬 필터 + 이름순 + 태그 */}
      {!isTrash && (
        <div className="flex items-center gap-1.5 px-4 py-2 border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900">
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
          <TitleSortDropdown
            isActive={sort === 'title'}
            dir={titleDir}
            onSelect={(d) => { setSort('title'); setTitleDir(d) }}
          />
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
        {isFetching && memos.length === 0 ? (
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
        ) : !isTrash && filtered.all.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-gray-400">
            <p className="text-sm">검색 결과가 없습니다</p>
            {(search || activeTag) && (
              <button
                onClick={() => { setSearch(''); setActiveTag(null) }}
                className="text-xs text-violet-500 hover:text-violet-700 underline"
              >
                필터 초기화
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

      {/* 폴더 컨텍스트 메뉴 */}
      {menu && (() => {
        const menuFolder = folders.find((f) => f.id === menu.folderId)
        if (!menuFolder) return null
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
            onClick={() => setMenu(null)}
          >
            <div
              className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg py-1 w-56"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-3 py-2 text-xs font-medium text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-700 truncate">
                {menuFolder.name}
              </div>
              <button
                className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                onClick={() => startEdit(menuFolder.id, menuFolder.name)}
              >
                <Pencil size={14} /> 이름 변경
              </button>
              <button
                className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                onClick={() => { setColorTarget(menuFolder); setMenu(null) }}
              >
                <Palette size={14} /> 색상 변경
              </button>
              <button
                className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                onClick={() => { setNewFolderParentId(menuFolder.id); setMenu(null); setShowNewFolderModal(true) }}
              >
                <Plus size={14} /> 하위 폴더
              </button>
              <hr className="my-1 border-gray-200 dark:border-gray-700" />
              <button
                className="w-full flex items-center gap-2 px-3 py-2.5 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                onClick={() => handleDelete(menuFolder.id)}
              >
                <Trash2 size={14} /> 삭제
              </button>
            </div>
          </div>
        )
      })()}

      {/* 색상 변경 모달 */}
      {colorTarget && (
        <ColorWheelModal
          initialH={colorTarget.colorH}
          initialS={colorTarget.colorS}
          initialL={colorTarget.colorL}
          onConfirm={(h, s, l) => { updateColor(colorTarget.id, h, s, l).catch(console.error); setColorTarget(null) }}
          onClose={() => setColorTarget(null)}
        />
      )}

      {/* 모바일 폴더 생성 모달 */}
      {showNewFolderModal && (
        <ColorWheelModal
          showNameInput
          initialName=""
          onConfirm={handleNewFolderConfirm}
          onClose={() => setShowNewFolderModal(false)}
        />
      )}
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

function TitleSortDropdown({
  isActive,
  dir,
  onSelect,
}: {
  isActive: boolean
  dir: TitleDir
  onSelect: (dir: TitleDir) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const OPTIONS: { value: TitleDir; label: string; icon: string }[] = [
    { value: 'asc',  label: '오름차순 (ㄱ → ㅎ)', icon: '↑' },
    { value: 'desc', label: '내림차순 (ㅎ → ㄱ)', icon: '↓' },
  ]

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border transition-colors',
          isActive
            ? 'border-violet-500 bg-violet-50 dark:bg-violet-950/30 text-violet-600 dark:text-violet-400'
            : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300'
        )}
      >
        이름순
        <span className="text-[10px] leading-none font-mono">
          {isActive ? (dir === 'asc' ? '↑' : '↓') : '▾'}
        </span>
      </button>

      {open && (
        <div className="absolute top-[calc(100%+6px)] left-0 z-50 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg overflow-hidden min-w-[160px]">
          {OPTIONS.map(({ value, label, icon }) => (
            <div
              key={value}
              onClick={() => { onSelect(value); setOpen(false) }}
              className={cn(
                'flex items-center gap-2 px-3.5 py-2.5 text-xs cursor-pointer transition-colors select-none',
                isActive && dir === value
                  ? 'bg-violet-50 dark:bg-violet-950/20 text-violet-600 dark:text-violet-400 font-medium'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
              )}
            >
              <span className="w-3 text-center font-mono">{icon}</span>
              <span className="flex-1">{label}</span>
              {isActive && dir === value && <span className="text-violet-500">✓</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
