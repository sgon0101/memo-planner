'use client'

import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
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
import { useQuery } from '@tanstack/react-query'
import { MemoListSkeleton } from '@/components/ui/Skeleton'
import MemoCard from './MemoCard'
import ColorWheelModal from './ColorWheelModal'
import TimelineFilter from './TimelineFilter'
import { useConfirm } from '@/components/ui/ConfirmModal'

const PAGE_SIZE = 20

type SortKey = 'updated' | 'created' | 'title' | 'starred' | 'pinned'

type TitleDir = 'asc' | 'desc'
type ViewMode = 'card' | 'list' | 'timeline'

export default function MemoList() {
  const router = useRouter()
  const { selectedFolderId, folders, selectFolder } = useFolderStore()
  // 모바일 폴더 dropdown용 메모 갯수 (FolderPanel과 동일 queryKey로 캐시 공유)
  const { data: folderCountRows } = useQuery({
    queryKey: ['memo-folder-counts'],
    queryFn: async () => {
      const supabase = createClient()
      const { data } = await supabase.from('memos').select('folder_id').eq('is_deleted', false)
      return data ?? []
    },
    staleTime: 15_000,
  })
  const folderMemoCount = (folderCountRows ?? []).reduce<Map<string, number>>((acc, row) => {
    const fid = (row as { folder_id: string | null }).folder_id
    if (fid) acc.set(fid, (acc.get(fid) ?? 0) + 1)
    return acc
  }, new Map<string, number>())
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
  const confirm = useConfirm()

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
  // 실제 스크롤 컨테이너 ref — sessionStorage 측정/복원에 사용 (data-scroll-root 직접 잡기)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
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

  // 폴더 변경 시 표시 개수 + 선택 초기화 + 스크롤 복원
  // sessionStorage에 같은 folderId 상태가 있으면 displayCount/scroll을 복원
  // (메모 클릭 → 메모 보고 뒤로가기 시나리오)
  const [pendingScroll, setPendingScroll] = useState<number | null>(null)
  // 정렬·필터 상태 — scroll listener effect의 deps에서 참조하므로 effect보다 먼저 선언
  const [sort, setSort] = useState<SortKey>('updated')
  const [titleDir, setTitleDir] = useState<TitleDir>('asc')
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [activeWiki, setActiveWiki] = useState<string | null>(null)
  // 폴더 effect — mount는 sessionStorage 복원, 진짜 폴더 변경 시만 reset.
  // hydration/store 동기화로 selectedFolderId가 mount 직후 두 번 갱신되어
  // 두 번째 발화에서 reset 분기를 타며 displayCount가 PAGE_SIZE로 돌아가던
  // race condition 차단 (prevFolderIdRef로 첫 마운트 vs 진짜 변경 구분).
  const prevFolderIdRef = useRef<string | null | undefined>(undefined)
  // 복원된 displayCount 보호 — 다른 effect/handler가 PAGE_SIZE로 reset해도
  // 이 ref가 살아있는 한 무시하고 복원값 유지. 진짜 폴더 변경 시에만 null로.
  const restoredCountRef = useRef<number | null>(null)
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    const prev = prevFolderIdRef.current
    prevFolderIdRef.current = selectedFolderId

    if (prev === undefined) {
      // 첫 마운트 — sessionStorage 복원 시도
      if (typeof window !== 'undefined') {
        const saved = sessionStorage.getItem('memo-list-state')
        if (saved) {
          try {
            const parsed = JSON.parse(saved) as {
              folderId: string | null; displayCount: number; scrollY: number
              sort?: SortKey; titleDir?: TitleDir; activeTag?: string | null; activeWiki?: string | null
            }
            if (parsed.folderId === selectedFolderId && typeof parsed.displayCount === 'number' && typeof parsed.scrollY === 'number') {
              setDisplayCount(parsed.displayCount)
              restoredCountRef.current = parsed.displayCount  // 보호 ref
              setSelectedTrashIds(new Set())
              setPendingScroll(parsed.scrollY)
              if (parsed.sort) setSort(parsed.sort)
              if (parsed.titleDir) setTitleDir(parsed.titleDir)
              if (parsed.activeTag !== undefined) setActiveTag(parsed.activeTag)
              if (parsed.activeWiki !== undefined) setActiveWiki(parsed.activeWiki)
              sessionStorage.removeItem('memo-list-state')
              return
            }
          } catch { /* ignore */ }
        }
      }
      // 복원할 게 없으면 기본값 (mount 시점)
      setDisplayCount(PAGE_SIZE)
      setSelectedTrashIds(new Set())
      return
    }

    // 진짜 폴더 변경 — 정렬·필터도 기본값으로 reset, 보호 ref도 해제
    if (prev !== selectedFolderId) {
      restoredCountRef.current = null
      setDisplayCount(PAGE_SIZE)
      setSelectedTrashIds(new Set())
      setSort('updated')
      setTitleDir('asc')
      setActiveTag(null)
      setActiveWiki(null)
    }
  }, [selectedFolderId])

  // displayCount 보호 — 복원 후 다른 effect가 PAGE_SIZE로 reset하면 다시 복원값으로
  useEffect(() => {
    if (restoredCountRef.current === null) return
    if (displayCount < restoredCountRef.current) {
      setDisplayCount(restoredCountRef.current)
    }
  }, [displayCount])

  // pendingScroll 적용 — setInterval 100ms 폴링. ref가 늦게 마운트되거나
  // 데이터(useMemos)가 늦게 들어와도 계속 시도. memos.length를 deps에서 빼
  // re-run으로 인한 cleanup race condition 차단. 30초 안전 timeout.
  useEffect(() => {
    if (pendingScroll === null) return
    const target = pendingScroll
    let applied = false
    const intervalId = setInterval(() => {
      if (applied) return
      const scrollEl = scrollContainerRef.current
      if (!scrollEl) return
      const maxScroll = scrollEl.scrollHeight - scrollEl.clientHeight
      if (maxScroll >= target - 4) {
        scrollEl.scrollTop = target
        applied = true
        setPendingScroll(null)
        clearInterval(intervalId)
      }
    }, 100)
    const safetyId = setTimeout(() => {
      if (!applied) {
        const scrollEl = scrollContainerRef.current
        if (scrollEl) scrollEl.scrollTop = target
        applied = true
        setPendingScroll(null)
        clearInterval(intervalId)
      }
    }, 30000)
    return () => { clearInterval(intervalId); clearTimeout(safetyId) }
  }, [pendingScroll])

  // 스크롤할 때마다 sessionStorage 업데이트 — unmount cleanup이 발화 안 되는
  // 케이스(Next.js App Router에서 Suspense/cache 등) 대비. 매 frame 1회 throttle.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const el = scrollContainerRef.current
    if (!el) return
    let scheduled = false
    function onScroll() {
      if (scheduled || !el) return
      scheduled = true
      requestAnimationFrame(() => {
        scheduled = false
        try {
          const scrollY = el?.scrollTop ?? 0
          if (scrollY > 0) {
            sessionStorage.setItem('memo-list-state', JSON.stringify({
              folderId: selectedFolderId,
              displayCount,
              scrollY,
              sort,
              titleDir,
              activeTag,
              activeWiki,
            }))
          }
        } catch { /* ignore */ }
      })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [selectedFolderId, displayCount, sort, titleDir, activeTag, activeWiki])

  // 전체 선택 체크박스 indeterminate 상태
  useEffect(() => {
    if (!selectAllRef.current) return
    const total = memos.length
    selectAllRef.current.indeterminate = selectedTrashIds.size > 0 && selectedTrashIds.size < total
  }, [selectedTrashIds.size, memos.length])

  const [search, setSearch] = useState('')
  const [view, setView] = useState<ViewMode>('card')

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

  // 모든 태그 수집 (autocompleteItems보다 먼저 선언 필요)
  const allTags = useMemo(() => {
    const set = new Set<string>()
    memos.forEach((m) => m.tags?.forEach((t) => set.add(t)))
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'ko'))
  }, [memos])

  // 모든 위키링크 수집
  const allWikis = useMemo(() => {
    const set = new Set<string>()
    memos.forEach((m) => m.wikiLinks?.forEach((w) => set.add(w)))
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'ko'))
  }, [memos])

  // 검색창 자동완성 — # 입력 후 글자가 있을 때만, [[ 입력 후 글자가 있을 때만 후보 노출
  // (등록된 전체는 위키/태그 칩 드롭다운에서 보면 되므로, 검색창 자동완성은 부분 입력 시에만)
  const [autocompleteIdx, setAutocompleteIdx] = useState(-1)
  const autocompleteItems = useMemo<{ type: 'tag' | 'wiki'; value: string }[]>(() => {
    const raw = search.trim()
    if (raw.startsWith('[[')) {
      const q = raw.slice(2).replace(/\]\]$/, '').toLowerCase()
      if (!q) return []  // 빈 prefix — 칩으로 확인
      return allWikis
        .filter((w) => w.toLowerCase().includes(q))
        .slice(0, 8)
        .map((value) => ({ type: 'wiki' as const, value }))
    }
    if (raw.startsWith('#')) {
      const q = raw.slice(1).toLowerCase()
      if (!q) return []
      return allTags
        .filter((t) => t.toLowerCase().includes(q))
        .slice(0, 8)
        .map((value) => ({ type: 'tag' as const, value }))
    }
    return []
  }, [search, allTags, allWikis])

  // 자동완성 후보가 바뀌면 강조 인덱스 초기화
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 의존값 변경 시 상태 리셋 (의도된 패턴)
  useEffect(() => { setAutocompleteIdx(-1) }, [autocompleteItems])

  const showAutocomplete = searchFocused && autocompleteItems.length > 0

  function pickAutocomplete(item: { type: 'tag' | 'wiki'; value: string }) {
    const prefix = item.type === 'tag' ? '#' : '[['
    setSearch(prefix + item.value)
    setAutocompleteIdx(-1)
    // 포커스는 유지하여 사용자가 추가 입력/Enter로 검색 시작 가능
    requestAnimationFrame(() => {
      const el = searchInputRef.current
      if (el) {
        el.focus()
        const next = prefix.length + item.value.length
        el.setSelectionRange(next, next)
      }
    })
  }

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!showAutocomplete) {
      if (e.key === 'Escape') searchInputRef.current?.blur()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setAutocompleteIdx((i) => Math.min(autocompleteItems.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setAutocompleteIdx((i) => Math.max(-1, i - 1))
    } else if (e.key === 'Enter') {
      if (autocompleteIdx >= 0) {
        e.preventDefault()
        pickAutocomplete(autocompleteItems[autocompleteIdx])
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setAutocompleteIdx(-1)
      searchInputRef.current?.blur()
    }
  }

  // 검색/정렬/태그 변경 시 표시 개수 초기화 (검색 필터가 항상 우선 적용)
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setDisplayCount(PAGE_SIZE) }, [search, sort, titleDir, activeTag, activeWiki])

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

  // #9 — Postgres FTS 서버 검색 (debounce 300ms)
  const {
    results: searchResults,
    isSearching,
    isFetching: searchFetching,
  } = useMemoSearch({
    query: search,
    folderId: isTrash ? 'trash' : selectedFolderId,
  })

  // Hybrid — 사용자 입력 즉시 client substring으로 1차 결과, 서버 FTS 응답 오면 합집합
  // (이전엔 server만 사용해 debounce + 왕복으로 400~800ms 지연이 체감됨)
  //
  // 한국어 띄어쓰기 무관 매칭:
  // (1) 다중 토큰 AND — 'A B' → A와 B 모두 substring 포함
  // (2) 공백 제거 substring — '일론머스크' 검색이 '일론 머스크' 메모 매칭, 반대도 가능
  const clientFiltered = useMemo(() => {
    const raw = search.trim()
    if (!raw) return null
    // prefix(#태그, [[위키)는 그대로 두고 본문도 같이 매칭되도록 정리
    let q = raw
    if (q.startsWith('[[')) q = q.slice(2).replace(/\]\]$/, '')
    else if (q.startsWith('#')) q = q.slice(1)
    if (!q) return null
    const lower = q.toLowerCase()
    const tokens = lower.split(/\s+/).filter(Boolean)
    const normalizedQ = lower.replace(/\s+/g, '')
    return memos.filter((m) => {
      const haystack = [
        m.title,
        m.contentText,
        ...(m.tags ?? []),
        ...(m.wikiLinks ?? []),
      ].join(' ').toLowerCase()
      const normalizedHaystack = haystack.replace(/\s+/g, '')
      // 토큰 every AND 또는 공백 제거 substring 어느 한쪽이라도 매칭
      return tokens.every((t) => haystack.includes(t))
        || normalizedHaystack.includes(normalizedQ)
    })
  }, [memos, search])

  const filtered = useMemo(() => {
    // 검색 중일 땐 server FTS + client substring 합집합 (id 중복 제거, server 우선)
    // server는 토큰 매칭(공백 단위)이라 "일론 머스크" 메모는 "일론"으로 잡지만 "일론머스크"는 못 잡음
    // → client substring으로 보완. 다른 폴더 메모는 server가 처리.
    let list: typeof memos
    if (isSearching) {
      const serverList = searchResults ?? []
      const clientList = clientFiltered ?? []
      const seen = new Set<string>()
      const merged: typeof memos = []
      // server 결과가 아직 안 왔으면 client 즉시 (즉각성 유지)
      // 도착하면 server 우선, client는 누락분 보완
      const primary = searchResults ? serverList : clientList
      const secondary = searchResults ? clientList : []
      for (const m of primary) {
        if (!seen.has(m.id)) { seen.add(m.id); merged.push(m) }
      }
      for (const m of secondary) {
        if (!seen.has(m.id)) { seen.add(m.id); merged.push(m) }
      }
      list = merged
    } else {
      list = [...memos]
    }

    if (activeTag) {
      list = list.filter((m) => m.tags?.includes(activeTag))
    }
    if (activeWiki) {
      list = list.filter((m) => m.wikiLinks?.includes(activeWiki))
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
  }, [memos, searchResults, clientFiltered, isSearching, sort, titleDir, isTrash, activeTag, activeWiki])

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
    const hasMemos = !!count && count > 0
    confirm.open({
      title: `"${folderName}" 폴더를 삭제할까요?`,
      description: hasMemos
        ? `안에 있는 메모 ${count}개도 함께 휴지통으로 이동돼요.`
        : '폴더만 삭제됩니다.',
      variant: 'danger',
      confirmLabel: '삭제',
      onConfirm: async () => {
        await removeFolder(id).catch(console.error)
        if (selectedFolderId === id) selectFolder(null)
      },
    })
  }

  async function handleBulkRestore() {
    const ids = [...selectedTrashIds]
    if (ids.length === 0) return
    await bulkRestore(ids).catch(console.error)
    setSelectedTrashIds(new Set())
  }

  function handleRestoreAll() {
    if (memos.length === 0) return
    confirm.open({
      title: `메모 ${memos.length}개를 모두 복원할까요?`,
      description: '휴지통에 있던 모든 메모가 원래 폴더로 돌아갑니다.',
      confirmLabel: '전체 복원',
      onConfirm: async () => {
        await bulkRestore(memos.map((m) => m.id)).catch(console.error)
        setSelectedTrashIds(new Set())
      },
    })
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
    searchQuery: search,
  }

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
                                className="flex-1 bg-transparent outline-none text-base border-b border-violet-400"
                                onClick={(e) => e.stopPropagation()}
                                autoComplete="off"
                                autoCorrect="off"
                                spellCheck={false}
                                data-1p-ignore="true"
                                data-lpignore="true"
                                data-form-type="other"
                                name="folder-name-edit"
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
                              {folderMemoCount.get(parent.id) ? (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 flex-shrink-0">
                                  {folderMemoCount.get(parent.id)}
                                </span>
                              ) : null}
                              <button
                                onClick={(e) => { e.stopPropagation(); openMenu(parent.id) }}
                                className="flex-shrink-0 p-1.5 mr-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400 transition-colors"
                              >
                                <MoreHorizontal size={16} />
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
                                      className="flex-1 bg-transparent outline-none text-base border-b border-violet-400"
                                      onClick={(e) => e.stopPropagation()}
                                      autoComplete="off"
                                      autoCorrect="off"
                                      spellCheck={false}
                                      data-1p-ignore="true"
                                      data-lpignore="true"
                                      data-form-type="other"
                                      name="folder-name-edit"
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
                                    {folderMemoCount.get(child.id) ? (
                                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 flex-shrink-0">
                                        {folderMemoCount.get(child.id)}
                                      </span>
                                    ) : null}
                                    <button
                                      onClick={(e) => { e.stopPropagation(); openMenu(child.id) }}
                                      className="flex-shrink-0 p-1.5 mr-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-400 transition-colors"
                                    >
                                      <MoreHorizontal size={16} />
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
                confirm.open({
                  title: '휴지통을 비울까요?',
                  description: `${memos.length}개의 메모가 영구 삭제돼요. 복구할 수 없어요.`,
                  variant: 'danger',
                  confirmLabel: '휴지통 비우기',
                  onConfirm: async () => { await emptyTrash().catch(console.error) },
                })
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
            type="search"
            name="memo-search"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            data-1p-ignore="true"
            data-lpignore="true"
            data-form-type="other"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            // 칩의 onMouseDown 처리(preventDefault) 후 blur가 발생하므로 약간 지연
            onBlur={() => setTimeout(() => setSearchFocused(false), 200)}
            onKeyDown={handleSearchKeyDown}
            placeholder={searchPlaceholder}
            className="w-full pl-8 pr-9 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-700 dark:text-gray-300 outline-none focus:ring-1 focus:ring-violet-400 [&::-webkit-search-cancel-button]:hidden"
          />
          {/* 데스크탑 — '/' 단축키 안내 */}
          <kbd className="hidden sm:flex absolute right-2 top-1/2 -translate-y-1/2 items-center justify-center w-5 h-5 text-[10px] font-mono text-gray-400 bg-white dark:bg-gray-950 border border-gray-200 dark:border-gray-700 rounded pointer-events-none">
            /
          </kbd>

          {/* 자동완성 드롭다운 — #태그 또는 [[위키 prefix 입력 시 */}
          {showAutocomplete && (
            <div className="absolute left-0 right-0 top-full mt-1 z-30 max-h-64 overflow-y-auto bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg py-1">
              {autocompleteItems.map((item, i) => {
                const isTag = item.type === 'tag'
                const active = i === autocompleteIdx
                return (
                  <button
                    key={`${item.type}-${item.value}`}
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); pickAutocomplete(item) }}
                    onMouseEnter={() => setAutocompleteIdx(i)}
                    className={cn(
                      'w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors',
                      active
                        ? (isTag ? 'bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-300' : 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-300')
                        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800',
                    )}
                  >
                    <span className={cn('text-[10px] font-mono px-1.5 py-0.5 rounded', isTag ? 'bg-blue-100 dark:bg-blue-950/50 text-blue-500' : 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-600')}>
                      {isTag ? '#' : '[['}
                    </span>
                    <span className="truncate flex-1">{item.value}</span>
                  </button>
                )
              })}
              <div className="px-3 py-1 text-[10px] text-gray-400 border-t border-gray-100 dark:border-gray-800">
                ↑↓ 이동 · Enter 선택 · Esc 닫기
              </div>
            </div>
          )}
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

      {/* 정렬 + 필터 칩 — 순서: 최신순 / 중요먼저 / 이름순 / 위키 / 태그 / 고정먼저
          모바일에서 한 줄에 안 들어가면 가로 스크롤(스와이프) */}
      {!isTrash && (
        <div className="flex items-center gap-1.5 px-4 py-2 border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-x-auto">
          <SortChip value="updated" current={sort} onSelect={setSort}>최신순</SortChip>
          <SortChip value="starred" current={sort} onSelect={setSort}>중요먼저</SortChip>
          <TitleSortDropdown
            isActive={sort === 'title'}
            dir={titleDir}
            onSelect={(d) => { setSort('title'); setTitleDir(d) }}
          />
          <WikiDropdown
            allWikis={allWikis}
            selectedWiki={activeWiki}
            onSelect={setActiveWiki}
          />
          <TagDropdown
            allTags={allTags}
            selectedTag={activeTag}
            onSelect={setActiveTag}
          />
          <SortChip value="pinned" current={sort} onSelect={setSort}>고정먼저</SortChip>
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
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
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
      <confirm.Render />
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

function SortChip({
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

function WikiDropdown({
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

function MemoSection({ memos, view, cols = 4, isTrash = false, onPin, onStar, onDelete, onLock, onUnlock, onRestore, onPermanentDelete, onMoveToFolder, selectedTrashIds, onToggleSelect, searchQuery }: {
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
