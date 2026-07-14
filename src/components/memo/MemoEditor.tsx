'use client'

import { useEffect, useRef, useCallback, useState, useLayoutEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { memoKeys, useMemos } from '@/hooks/useMemos'
import { useEditor, EditorContent, ReactNodeViewRenderer } from '@tiptap/react'
import { TextSelection } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import { Color } from '@tiptap/extension-color'
import { TextStyle } from '@tiptap/extension-text-style'
import Highlight from '@tiptap/extension-highlight'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import { ResizableImageView } from './ResizableImageView'
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { createLowlight, common } from 'lowlight'
import { History, Save, Star, Pin, ArrowLeft, PanelRight, Folder, ChevronDown, ChevronRight, Network, Trash2, MoreVertical } from 'lucide-react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { useMemoStore } from '@/store/memoStore'
import { useFolders } from '@/hooks/useFolders'
import { extractFirstImage } from '@/lib/memos/shared'
import { useVersions } from '@/hooks/useVersions'
import EditorToolbar from './EditorToolbar'
import EditorBubbleMenu from './EditorBubbleMenu'
import VersionHistory from './VersionHistory'
import CodeBlockView from './CodeBlockView'
import MemoSidePanel from './MemoSidePanel'
import WikiSuggest from './WikiSuggest'
import TagSuggest from './TagSuggest'
import SlashCommand from './SlashCommand'
import Modal from '@/components/ui/Modal'
import { useConfirm } from '@/components/ui/ConfirmModal'
import { toast } from '@/components/ui/Toast'
import { CustomEnterExtension } from '@/lib/tiptap/CustomEnterExtension'
import type { Memo, MemoVersion } from '@/types'
import { lsHomeMemosCache, lsHomeMemosCacheTs } from '@/lib/cache/lsKeys'
import { useAutoEmbed } from '@/hooks/useAutoEmbed'
import { createMemoOrQueue, updateMemoBodyOrQueue, uploadImageOrQueue } from '@/lib/sync/withQueue'
import { makeTempId, isTempId } from '@/lib/sync/queueDB'

const lowlight = createLowlight(common)
const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] }
const VERSION_COOLDOWN_MS = 5 * 60 * 1000
const AUTO_SAVE_INTERVAL_MS = 30 * 1000
const SAVED_DISPLAY_MS = 2000

type SaveStatus = 'idle' | 'unsaved' | 'saving' | 'saved'

interface MemoEditorProps {
  memoId: string
  initialTitle: string
  initialContent: Record<string, unknown>
  initialIsStarred?: boolean
  initialIsPinned?: boolean
  initialFolderId?: string | null
  initialFolderName?: string | null
  isNew?: boolean
}

function toMemo(row: Record<string, unknown>): Memo {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    folderId: (row.folder_id as string) ?? null,
    title: (row.title as string) ?? '',
    content: (row.content as Record<string, unknown>) ?? {},
    contentText: (row.content_text as string) ?? '',
    isPinned: (row.is_pinned as boolean) ?? false,
    isStarred: (row.is_starred as boolean) ?? false,
    isLocked: (row.is_locked as boolean) ?? false,
    lockedContent: (row.locked_content as string) ?? null,
    isDeleted: (row.is_deleted as boolean) ?? false,
    deletedAt: (row.deleted_at as string) ?? null,
    tags: (row.tags as string[]) ?? [],
    wikiLinks: (row.wiki_links as string[]) ?? [],
    linkedPlanIds: (row.linked_plan_ids as string[]) ?? [],
    thumbnailUrl: (row.thumbnail_url as string) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }
}

function getTaskStats(json: Record<string, unknown>): { done: number; total: number } {
  let done = 0, total = 0
  function traverse(node: Record<string, unknown>) {
    if (node.type === 'taskItem') {
      total++
      if ((node.attrs as Record<string, unknown>)?.checked) done++
    }
    const content = node.content as Record<string, unknown>[] | undefined
    content?.forEach(traverse)
  }
  traverse(json)
  return { done, total }
}

function formatRelativeTime(date: Date): string {
  const diff = Math.floor((Date.now() - date.getTime()) / 1000)
  if (diff < 60) return '방금 전'
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`
  return `${Math.floor(diff / 86400)}일 전`
}

function extractWikiLinks(text: string): string[] {
  const matches = [...text.matchAll(/\[\[([^\]]+)\]\]/g)]
  return [...new Set(matches.map((m) => m[1]))]
}

function extractTags(text: string): string[] {
  const matches = [...text.matchAll(/#([\w가-힣]+)/g)]
  return [...new Set(matches.map((m) => m[1]))]
}

export default function MemoEditor({ memoId, initialTitle, initialContent, initialIsStarred = false, initialIsPinned = false, initialFolderId = null, initialFolderName = null, isNew = false }: MemoEditorProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const fromGraph = searchParams.get('from') === 'graph'
  const supabase = createClient()
  const queryClient = useQueryClient()
  // 서버 상태는 React Query 단일 출처 — memoStore는 lastImageSwap 신호만 구독
  const lastImageSwap = useMemoStore((s) => s.lastImageSwap)
  const { folders } = useFolders()
  useMemos(undefined) // 전체 메모 캐시 사전 로드 → MemoSidePanel 즉각 표시

  const [title, setTitle] = useState(initialTitle)
  // Chrome Mobile autofill heuristic 회피 — 초기 readOnly, focus 시 해제
  const [titleReadOnly, setTitleReadOnly] = useState(true)
  // base64 인라인 이미지 자동 이주 중복 실행 방지
  const base64MigratingRef = useRef(false)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const triggerAutoEmbed = useAutoEmbed()
  const [createdId, setCreatedId] = useState<string | null>(isNew ? null : memoId)
  const [showHistory, setShowHistory] = useState(false)
  const [charCount, setCharCount] = useState(0)
  const [taskStats, setTaskStats] = useState({ done: 0, total: 0 })
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [tick, setTick] = useState(0)
  const [isStarred, setIsStarred] = useState(initialIsStarred)
  const [isPinned, setIsPinned] = useState(initialIsPinned)
  const [folderId, setFolderId] = useState<string | null>(initialFolderId)
  const [showFolderDropdown, setShowFolderDropdown] = useState(false)
  // 모바일 더보기 메뉴 — 휴지통/저장/패널/이력 통합
  const [showMoreMenu, setShowMoreMenu] = useState(false)
  const moreMenuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!showMoreMenu) return
    function onDown(e: MouseEvent | TouchEvent) {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) setShowMoreMenu(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
    }
  }, [showMoreMenu])
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => {
    // useState 초기화 시 folders가 빈 배열일 수 있어 useEffect로 보완
    return new Set<string>()
  })
  const [showLeaveDialog, setShowLeaveDialog] = useState(false)
  const [showSidePanel, setShowSidePanel] = useState(() => {
    if (typeof window === 'undefined') return false
    if (window.innerWidth < 768) return false  // 모바일: 항상 숨김
    const saved = localStorage.getItem('memoPanelOpen')
    return saved !== 'false'
  })
  const [pendingMemoId, setPendingMemoId] = useState<string | null>(null)
  const [wikiQuery, setWikiQuery] = useState<string | null>(null)
  const [wikiPos, setWikiPos] = useState({ x: 0, y: 0 })
  const [tagQuery, setTagQuery] = useState<string | null>(null)
  const [tagPos, setTagPos] = useState({ x: 0, y: 0 })
  // 슬래시 명령 — 빈 줄에서 `/` 입력 시 트리거
  const [slashQuery, setSlashQuery] = useState<string | null>(null)
  const [slashPos, setSlashPos] = useState({ x: 0, y: 0 })
  const [slashFrom, setSlashFrom] = useState(0)
  // 빈 메모 마크다운/슬래시 안내 hint — localStorage로 1회만 dismiss
  const [showMdHint, setShowMdHint] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return !window.localStorage.getItem('weave:md_hint_dismissed')
  })
  const confirm = useConfirm()

  const hasUnsavedRef = useRef(false)
  const folderIdRef = useRef<string | null>(initialFolderId ?? null)
  const titleRef = useRef(initialTitle)
  const createdIdRef = useRef<string | null>(isNew ? null : memoId)
  // 최신 상태를 ref에 동기화 — render 중 ref 갱신 대신 layout effect (이벤트/인터벌에서만 읽음)
  useLayoutEffect(() => {
    folderIdRef.current = folderId
    titleRef.current = title
    createdIdRef.current = createdId
  })
  const lastVersionSavedAtRef = useRef<number>(0)
  const savedDisplayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const newMemoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { saveVersion } = useVersions(createdId)
  const saveVersionRef = useRef(saveVersion)
  // eslint-disable-next-line react-hooks/refs
  saveVersionRef.current = saveVersion

  const save = useCallback(async (
    content: Record<string, unknown>,
    text: string,
    { skipNavigate = false }: { skipNavigate?: boolean } = {}
  ) => {
    setSaveStatus('saving')
    try {
      const id = createdIdRef.current
      if (id) {
        const wikiLinks = extractWikiLinks(text)
        const tags = extractTags(text)
        const updatedAt = new Date().toISOString()
        const firstImageUrl = extractFirstImage(content)
        // 원본 R2 URL을 그대로 저장 — 변환 없이 최고 화질 보장
        // base64 fallback(업로드 실패 시)은 DB에 저장하지 않음
        const thumbnailUrl = (firstImageUrl && !firstImageUrl.startsWith('data:'))
          ? firstImageUrl
          : null
        // PR-M1-B: 오프라인 또는 tempId면 큐로 fall through (overwrite — 같은 memoId는 최신만 보관)
        const cachedMemo = queryClient.getQueryData<Memo[]>(memoKeys.all())?.find((m) => m.id === id)
        const knownUpdatedAt = cachedMemo?.updatedAt ?? updatedAt
        await updateMemoBodyOrQueue({
          recordId: id,
          fields: {
            title: titleRef.current,
            content,
            content_text: text,
            wiki_links: wikiLinks,
            tags,
            thumbnail_url: thumbnailUrl,
          },
          knownUpdatedAt,
        })

        // 목록 캐시에는 content 제외 — 에디터는 직접 DB fetch
        const patch = { title: titleRef.current, contentText: text, updatedAt, thumbnailUrl, tags, wikiLinks }
        queryClient.setQueryData<Memo[]>(
          memoKeys.all(),
          (old) => old?.map((m) => m.id === id ? { ...m, ...patch } : m)
        )

        // 홈 최근 메모 캐시 즉시 갱신 — 해당 id 항목을 최신 정보로 + 맨 앞 정렬
        type HomeMemo = { id: string; title: string; contentText: string; updatedAt: string; isStarred: boolean; isPinned: boolean }
        queryClient.setQueryData<{ recentMemos: HomeMemo[] } | undefined>(
          ['home-memos'],
          (old) => {
            if (!old) return old
            const existing = old.recentMemos.find((m) => m.id === id)
            const next: HomeMemo = existing
              ? { ...existing, title: titleRef.current, contentText: text, updatedAt }
              : { id, title: titleRef.current, contentText: text, updatedAt, isStarred: false, isPinned: false }
            const rest = old.recentMemos.filter((m) => m.id !== id)
            return { ...old, recentMemos: [next, ...rest].slice(0, 5) }
          },
        )
        if (typeof window !== 'undefined') {
          try {
            const raw = (() => { const k = lsHomeMemosCache(); return k ? localStorage.getItem(k) : null })()
            if (raw) {
              const parsed = JSON.parse(raw) as { recentMemos: HomeMemo[] }
              const existing = parsed.recentMemos.find((m) => m.id === id)
              const next: HomeMemo = existing
                ? { ...existing, title: titleRef.current, contentText: text, updatedAt }
                : { id, title: titleRef.current, contentText: text, updatedAt, isStarred: false, isPinned: false }
              const rest = parsed.recentMemos.filter((m) => m.id !== id)
              const nextCache = { ...parsed, recentMemos: [next, ...rest].slice(0, 5) }
              { const k = lsHomeMemosCache(); if (k) localStorage.setItem(k, JSON.stringify(nextCache)) }
              { const k = lsHomeMemosCacheTs(); if (k) localStorage.setItem(k, String(Date.now())) }
            }
          } catch { /* ignore */ }
        }

        const now = Date.now()
        if (now - lastVersionSavedAtRef.current > VERSION_COOLDOWN_MS) {
          lastVersionSavedAtRef.current = now
          saveVersionRef.current(content, text, titleRef.current).catch(console.error)
        }

        // 임베딩 fire-and-forget — 사용자 체감엔 영향 없음
        // 저장 직후 호출이지만 OpenAI 호출은 비동기로 백그라운드 처리
        void fetch('/api/embeddings/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ memoId: id }),
        }).catch(() => { /* 임베딩 실패는 silent */ })
      } else {
        // PR-M1-B 핫픽스: getUser()는 offline에서 토큰 refresh fetch fail로 throw → user_id=''로 큐 적재 후 RLS 400
        // getSession()은 cookie/localStorage sync 읽기 → 네트워크 호출 없음
        const { data: { session } } = await supabase.auth.getSession()
        const userId = session?.user?.id
        if (!userId) {
          throw new Error('로그인 세션이 만료되었어요. 다시 로그인해주세요.')
        }
        // 새 메모 INSERT에도 썸네일 추출 — 이미지 첨부 후 1.5s 안에 페이지를 벗어나면
        // 다음 update 분기가 안 돌아 thumbnail_url이 null로 굳던 버그 방지
        const firstImageUrl = extractFirstImage(content)
        const insertThumb = (firstImageUrl && !firstImageUrl.startsWith('data:'))
          ? firstImageUrl
          : null
        // PR-M1-B: tempId 부여 → online이면 즉시 server insert, offline이면 큐
        const tempId = makeTempId('memo')
        const insertFields = {
          user_id: userId,
          title: titleRef.current,
          content,
          content_text: text,
          tags: extractTags(text),
          wiki_links: extractWikiLinks(text),
          folder_id: folderIdRef.current,
          thumbnail_url: insertThumb,
        }
        const createResult = await createMemoOrQueue(insertFields, tempId)
        const newMemo: Memo = createResult.row
          ? toMemo(createResult.row)
          : {
              id: tempId,
              userId: insertFields.user_id,
              folderId: insertFields.folder_id ?? null,
              title: insertFields.title,
              content: insertFields.content as Record<string, unknown>,
              contentText: insertFields.content_text,
              isPinned: false,
              isStarred: false,
              isLocked: false,
              lockedContent: null,
              isDeleted: false,
              deletedAt: null,
              tags: insertFields.tags,
              wikiLinks: insertFields.wiki_links,
              linkedPlanIds: [],
              thumbnailUrl: insertFields.thumbnail_url,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }
        createdIdRef.current = newMemo.id
        setCreatedId(newMemo.id)

        // 새 메모 임베딩 — online에서 진짜 ID일 때만 (tempId면 flush 후 자동 백필이 따로 없으니
        // 추후 update 시 자동임베드가 트리거됨)
        if (!isTempId(newMemo.id)) {
          void fetch('/api/embeddings/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ memoId: newMemo.id }),
          }).catch(() => { /* 임베딩 실패는 silent */ })
        }
        // 목록 캐시에는 content 제외 — 에디터는 직접 DB fetch
        const newMemoForCache = { ...newMemo, content: {} as Record<string, unknown> }
        queryClient.setQueryData<Memo[]>(
          memoKeys.all(),
          (old) => old ? [newMemoForCache, ...old] : [newMemoForCache]
        )

        // 홈 최근 메모 캐시 즉시 추가 — 새 메모는 항상 맨 앞, 5개로 자름
        type HomeMemoIns = { id: string; title: string; contentText: string; updatedAt: string; isStarred: boolean; isPinned: boolean }
        const newHomeEntry: HomeMemoIns = {
          id: newMemo.id,
          title: newMemo.title,
          contentText: newMemo.contentText,
          updatedAt: newMemo.updatedAt,
          isStarred: newMemo.isStarred,
          isPinned: newMemo.isPinned,
        }
        queryClient.setQueryData<{ recentMemos: HomeMemoIns[] } | undefined>(
          ['home-memos'],
          (old) => old
            ? { ...old, recentMemos: [newHomeEntry, ...old.recentMemos].slice(0, 5) }
            : { recentMemos: [newHomeEntry] },
        )
        if (typeof window !== 'undefined') {
          try {
            const raw = (() => { const k = lsHomeMemosCache(); return k ? localStorage.getItem(k) : null })()
            const parsed = raw ? JSON.parse(raw) as { recentMemos: HomeMemoIns[] } : { recentMemos: [] }
            const nextCache = { ...parsed, recentMemos: [newHomeEntry, ...parsed.recentMemos].slice(0, 5) }
            { const k = lsHomeMemosCache(); if (k) localStorage.setItem(k, JSON.stringify(nextCache)) }
            { const k = lsHomeMemosCacheTs(); if (k) localStorage.setItem(k, String(Date.now())) }
          } catch { /* ignore */ }
        }
        // 폴더 카운트 즉시 반영
        const targetFolderId = folderIdRef.current
        queryClient.setQueryData<Array<{ folder_id: string | null }>>(
          ['memo-folder-counts'],
          (old) => old ? [...old, { folder_id: targetFolderId }] : [{ folder_id: targetFolderId }]
        )
        queryClient.invalidateQueries({ queryKey: ['memo-folder-counts'] })

        if (!skipNavigate) {
          // router.replace는 client-side navigation을 트리거해 페이지 컴포넌트가
          // 재마운트 → Tiptap editor 재생성 → 사용자가 그 동안 입력한 내용 손실.
          // history.replaceState는 URL만 silent 업데이트해 깜빡임 없음.
          // 사용자가 새로고침/공유 시 URL이 정확한 id로 보임.
          if (typeof window !== 'undefined') {
            window.history.replaceState(null, '', `/memo/${newMemo.id}`)
          }
        }
      }

      hasUnsavedRef.current = false
      setSaveStatus('saved')
      setSavedAt(new Date())
      // PR-6: 저장 성공 후 자동 임베딩 트리거 (debounced 5s, fire-and-forget)
      const idForEmbed = createdIdRef.current
      if (idForEmbed) triggerAutoEmbed(idForEmbed)

      if (savedDisplayTimerRef.current) clearTimeout(savedDisplayTimerRef.current)
      savedDisplayTimerRef.current = setTimeout(() => setSaveStatus('idle'), SAVED_DISPLAY_MS)
    } catch (e) {
      console.error('저장 실패:', e)
      setSaveStatus('unsaved')
    }
  }, [supabase, queryClient, router])

  const saveRef = useRef(save)
  // eslint-disable-next-line react-hooks/refs
  saveRef.current = save

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      CustomEnterExtension,
      Underline,
      TextStyle,
      Color.configure({ types: ['textStyle'] }),
      Highlight.configure({ multicolor: true }),
      Link.configure({ openOnClick: false }),
      Image.extend({
        addAttributes() {
          return {
            ...this.parent?.(),
            width: {
              default: null,
              renderHTML: (attrs) => (attrs.width ? { width: attrs.width } : {}),
              parseHTML: (el) => el.getAttribute('width'),
            },
            srcMd: {
              default: null,
              renderHTML: (attrs) => (attrs.srcMd ? { 'data-src-md': attrs.srcMd } : {}),
              parseHTML: (el) => el.getAttribute('data-src-md'),
            },
            srcSm: {
              default: null,
              renderHTML: (attrs) => (attrs.srcSm ? { 'data-src-sm': attrs.srcSm } : {}),
              parseHTML: (el) => el.getAttribute('data-src-sm'),
            },
            // PR-M1-C: 오프라인 임시 이미지 식별자 (IDB image_blobs lookup용)
            localBlobId: {
              default: null,
              renderHTML: (attrs) => (attrs.localBlobId ? { 'data-local-blob-id': attrs.localBlobId } : {}),
              parseHTML: (el) => el.getAttribute('data-local-blob-id'),
            },
          }
        },
        addNodeView() {
          return ReactNodeViewRenderer(ResizableImageView)
        },
      }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      TaskList,
      TaskItem.configure({ nested: true }),
      CodeBlockLowlight.extend({
        addNodeView() {
          return ReactNodeViewRenderer(CodeBlockView)
        },
      }).configure({ lowlight }),
    ],
    content: Object.keys(initialContent).length > 0 ? initialContent : EMPTY_DOC,
    editorProps: {
      attributes: {
        class: 'outline-none min-h-[calc(100vh-220px)] px-3 md:px-8 py-4 md:py-6 prose prose-sm dark:prose-invert max-w-none',
      },
      // 이미지 노드 옆 빈 공간 클릭/터치 시 selection을 image NodeSelection이 아닌
      // 인접 TextSelection으로 강제 변환 — 활성화 해제 효과.
      // 실제 <img> 영역 click은 ResizableImageView의 onClick(stopPropagation)이 처리.
      handleClickOn(view, pos, node, _nodePos, event) {
        if (node.type.name !== 'image') return false
        const target = event.target as HTMLElement | null
        // 실제 img 또는 리사이즈 핸들/툴바 위 클릭 → ResizableImageView가 처리
        if (target && (target.tagName === 'IMG' || target.closest('img') || target.closest('[data-resize-handle]') || target.closest('button'))) {
          return false
        }
        // 그 외(이미지 옆 빈 영역) — TextSelection으로 옮겨 image 활성화 해제
        try {
          const $pos = view.state.doc.resolve(pos)
          const sel = TextSelection.near($pos)
          view.dispatch(view.state.tr.setSelection(sel))
        } catch { /* ignore */ }
        return true
      },
    },
    onUpdate({ editor }) {
      hasUnsavedRef.current = true
      setSaveStatus('unsaved')
      const text = editor.getText()
      setCharCount(text.replace(/\s/g, '').length)
      setTaskStats(getTaskStats(editor.getJSON() as Record<string, unknown>))

      // 자동완성 감지 ([[위키]] / #태그 / /슬래시)
      const { state, view } = editor
      const { from } = state.selection
      const textBefore = state.doc.textBetween(Math.max(0, from - 50), from, '\n')
      const wikiMatch = textBefore.match(/\[\[([^\]]*)$/)
      const tagMatch = !wikiMatch && textBefore.match(/#([\w가-힣]*)$/)
      // 슬래시: 줄 시작에서 `/` + 영문/한글 검색어 — 위키·태그 우선
      const slashMatch = !wikiMatch && !tagMatch && textBefore.match(/(?:^|\n)\/([\w가-힣]*)$/)
      if (wikiMatch) {
        const coords = view.coordsAtPos(from)
        setWikiQuery(wikiMatch[1])
        setWikiPos({ x: coords.left, y: coords.bottom })
        setTagQuery(null)
        setSlashQuery(null)
      } else if (tagMatch) {
        const coords = view.coordsAtPos(from)
        setTagQuery(tagMatch[1])
        setTagPos({ x: coords.left, y: coords.bottom })
        setWikiQuery(null)
        setSlashQuery(null)
      } else if (slashMatch) {
        const coords = view.coordsAtPos(from)
        setSlashQuery(slashMatch[1])
        setSlashPos({ x: coords.left, y: coords.bottom })
        setSlashFrom(from - slashMatch[1].length - 1)
        setWikiQuery(null)
        setTagQuery(null)
      } else {
        setWikiQuery(null)
        setTagQuery(null)
        setSlashQuery(null)
      }

      // 신규 메모: 2초 debounce로 즉시 DB 레코드 생성
      if (!createdIdRef.current) {
        if (newMemoTimerRef.current) clearTimeout(newMemoTimerRef.current)
        newMemoTimerRef.current = setTimeout(() => {
          if (!editorRef.current || createdIdRef.current) return
          const json = editorRef.current.getJSON() as Record<string, unknown>
          const t = editorRef.current.getText()
          saveRef.current(json, t)
        }, 2000)
      }

      // 외부 HTML 붙여넣기로 유입된 base64 인라인 이미지 → R2 자동 이주
      void migrateInlineBase64()
    },
    onCreate({ editor }) {
      const text = editor.getText()
      setCharCount(text.replace(/\s/g, '').length)
      setTaskStats(getTaskStats(editor.getJSON() as Record<string, unknown>))
    },
  })

  const editorRef = useRef(editor)
  // eslint-disable-next-line react-hooks/refs
  editorRef.current = editor

  // PR-M1-C: image-swap 알림 수신 → Tiptap doc 안 image node 중 localBlobId 매칭되는 것들 attrs 갱신
  useEffect(() => {
    if (!lastImageSwap || !editorRef.current) return
    const editor = editorRef.current
    const mapById = new Map(lastImageSwap.mappings.map((m) => [m.localBlobId, m]))
    if (mapById.size === 0) return
    let changed = false
    editor.commands.command(({ tr, state }) => {
      state.doc.descendants((node, pos) => {
        if (node.type.name !== 'image') return
        const lb = node.attrs.localBlobId as string | null
        if (!lb) return
        const m = mapById.get(lb)
        if (!m) return
        tr.setNodeMarkup(pos, undefined, {
          ...node.attrs,
          src: m.src,
          srcMd: m.srcMd,
          srcSm: m.srcSm,
          localBlobId: null,
        })
        changed = true
      })
      return changed
    })
  }, [lastImageSwap])

  // 30초 자동 저장
  useEffect(() => {
    const interval = setInterval(() => {
      if (!hasUnsavedRef.current || !editorRef.current) return
      const json = editorRef.current.getJSON() as Record<string, unknown>
      const text = editorRef.current.getText()
      saveRef.current(json, text)
    }, AUTO_SAVE_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [])

  // Ctrl+S 저장 — e.code로 물리 키 매치 (한글 IME/Caps Lock/Shift 무관하게 항상 동작)
  // 이전엔 e.key === 's'만 체크 → 한글 IME 상태에서 e.key='ㄴ'/'Process'라 무동작 버그
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const isCtrlS = (e.ctrlKey || e.metaKey)
        && (e.code === 'KeyS' || e.key === 's' || e.key === 'S')
      if (isCtrlS) {
        e.preventDefault()
        if (!editorRef.current) return
        const json = editorRef.current.getJSON() as Record<string, unknown>
        const text = editorRef.current.getText()
        saveRef.current(json, text)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  // 페이지 이탈 직전 강제 저장 — 30초 자동저장 사이에 사용자가 빠져나가는 사고 방지.
  // ① beforeunload: 탭 닫기·새로고침·다른 사이트 이동 직전 (데스크탑 신뢰성 ↑)
  // ② pagehide:    모바일 Safari 등에서 beforeunload 대신 발화
  // ③ visibilitychange: 백그라운드 전환·앱 스위치·다른 탭 전환 (모바일 안전망)
  // unload 콜백 내부의 비동기 호출은 보장이 약하지만 best-effort.
  useEffect(() => {
    function fireSave() {
      if (!hasUnsavedRef.current || !editorRef.current) return
      const json = editorRef.current.getJSON() as Record<string, unknown>
      const text = editorRef.current.getText()
      // skipNavigate: 이탈 중이므로 추가 nav 차단
      saveRef.current(json, text, { skipNavigate: true }).catch(() => { /* best-effort */ })
    }
    function onBeforeUnload() { fireSave() }
    function onPageHide() { fireSave() }
    function onVisibility() {
      if (document.visibilityState === 'hidden') fireSave()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    window.addEventListener('pagehide', onPageHide)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      window.removeEventListener('pagehide', onPageHide)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  // 제목 변경 시 unsaved 표시
  useEffect(() => {
    if (title !== initialTitle) {
      hasUnsavedRef.current = true
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSaveStatus('unsaved')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title])

  // savedAt 상대 시간 갱신 (1분마다)
  useEffect(() => {
    const interval = setInterval(() => setTick((v) => v + 1), 60000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    return () => {
      if (savedDisplayTimerRef.current) clearTimeout(savedDisplayTimerRef.current)
      if (newMemoTimerRef.current) clearTimeout(newMemoTimerRef.current)
    }
  }, [])

  function showUploadToast(msg: string) {
    // 압축률 등 "성공" 톤이 기본 — 실패 시는 별도 toast.error로
    toast.success(msg)
  }

  // ─── base64 인라인 이미지 자동 이주 (유입 차단) ─────────────────────
  // 외부 앱(웹페이지·문서 등)의 서식 있는 내용을 붙여넣으면 HTML 속 인라인
  // base64 이미지가 R2 업로드 경로를 우회해 본문 JSONB에 그대로 저장됨 —
  // 16MB 메모 하나가 로딩 7초·r2-gc 오판 사고·백업 0개를 유발한 사고 체인의 근원
  // (2026-07-11). onUpdate에서 감지 즉시 R2로 올리고 노드 attrs를 URL로 교체한다.
  // 오프라인이면 uploadImageOrQueue가 IDB 큐 + localBlobId로 동일 처리.
  async function migrateInlineBase64() {
    const ed = editorRef.current
    if (!ed || base64MigratingRef.current) return
    // 존재 검사 — 첫 발견 즉시 중단하는 저렴한 스캔
    let exists = false
    ed.state.doc.descendants((node) => {
      if (exists) return false
      if (node.type.name === 'image' && typeof node.attrs.src === 'string' && node.attrs.src.startsWith('data:image/')) exists = true
      return !exists
    })
    if (!exists) return

    base64MigratingRef.current = true
    let migrated = 0
    try {
      // 매회 fresh 스캔으로 첫 data: 노드를 처리 — 업로드 중 편집으로 인한 pos 변동에 안전
      for (let guard = 0; guard < 20; guard++) {
        const cur = editorRef.current
        if (!cur) break
        let src = ''
        cur.state.doc.descendants((node) => {
          if (src) return false
          if (node.type.name === 'image' && typeof node.attrs.src === 'string' && node.attrs.src.startsWith('data:image/')) src = node.attrs.src
          return !src
        })
        if (!src) break

        const blob = await (await fetch(src)).blob()
        const file = new File([blob], `pasted-${Date.now()}.png`, { type: blob.type || 'image/png' })
        const result = await uploadImageOrQueue(file)

        const after = editorRef.current
        if (!after) break
        let applied = false
        after.commands.command(({ tr, state }) => {
          state.doc.descendants((node, pos) => {
            if (applied) return false
            if (node.type.name === 'image' && node.attrs.src === src) {
              const attrs = result.queued
                ? { ...node.attrs, src: '', localBlobId: result.localBlobId }
                : { ...node.attrs, src: result.src, srcMd: result.srcMd ?? null, srcSm: result.srcSm ?? null }
              tr.setNodeMarkup(pos, undefined, attrs)
              applied = true
            }
            return !applied
          })
          return applied
        })
        if (!applied) break
        migrated++
      }
      if (migrated > 0) {
        toast.success(`붙여넣은 이미지 ${migrated}개를 저장소로 옮겼어요 (메모 용량 최적화)`)
      }
    } catch { /* 실패 시 다음 onUpdate에서 자동 재시도 */ }
    finally { base64MigratingRef.current = false }
  }

  async function handleImageUpload(file: File) {
    if (!editor) return
    // PR-M1-C: online이면 즉시 R2, offline이면 IDB+큐 (localBlobId만 attrs에 박힘)
    try {
      const result = await uploadImageOrQueue(file)
      if (result.queued) {
        // offline — localBlobId만 박고 ResizableImageView가 IDB blob URL 생성
        editor.chain().focus().insertContent({
          type: 'image',
          attrs: { src: '', localBlobId: result.localBlobId, width: '50%' },
        }).run()
        showUploadToast('오프라인 상태 — 이미지가 임시 저장됐어요. 온라인 복귀 시 자동 업로드돼요.')
        return
      }
      // online — 진짜 R2 URL들로 즉시 표시
      editor.chain().focus().insertContent({
        type: 'image',
        attrs: {
          src: result.src,
          srcMd: result.srcMd ?? null,
          srcSm: result.srcSm ?? null,
          width: '50%',
        },
      }).run()
      const orig = ((result.originalSize ?? 0) / 1024 / 1024).toFixed(1)
      const comp = ((result.compressedSize ?? 0) / 1024 / 1024).toFixed(1)
      if ((result.savedPercent ?? 0) > 0) {
        showUploadToast(`이미지가 ${result.savedPercent}% 압축됐어요 (${orig}MB → ${comp}MB)`)
      } else {
        showUploadToast('이미지가 업로드됐어요')
      }
    } catch (e) {
      // server validation/quota 실패 등 — 토스트로 알리고 종료
      const msg = e instanceof Error ? e.message : '이미지 업로드 실패'
      toast.error(msg.includes('upload failed: 413') ? '스토리지 한도를 초과했어요. 설정에서 정리 후 다시 시도해주세요.' : '이미지 업로드에 실패했어요. 잠시 후 다시 시도해주세요.')
    }
  }

  function handleBackToList() {
    if (hasUnsavedRef.current) {
      setShowLeaveDialog(true)
    } else {
      router.push('/memo')
    }
  }

  function handleBackToGraph() {
    const id = createdIdRef.current ?? memoId
    router.push(id ? `/graph?highlight=${id}` : '/graph')
  }

  function handleTagSelect(tag: string) {
    if (!editor) return
    const { state } = editor
    const { from } = state.selection
    const textBefore = state.doc.textBetween(Math.max(0, from - 50), from, '\n')
    const tagMatch = textBefore.match(/#([\w가-힣]*)$/)
    if (!tagMatch) { setTagQuery(null); return }
    const startPos = from - tagMatch[0].length
    editor
      .chain()
      .focus()
      .deleteRange({ from: startPos, to: from })
      .insertContent(`#${tag}`)
      .run()
    setTagQuery(null)
  }

  function handleWikiSelect(title: string) {
    if (!editor) return
    const { state } = editor
    const { from } = state.selection
    const textBefore = state.doc.textBetween(Math.max(0, from - 50), from, '\n')
    const wikiMatch = textBefore.match(/\[\[([^\]]*)$/)
    if (!wikiMatch) { setWikiQuery(null); return }
    const startPos = from - (wikiMatch[0].length)
    editor
      .chain()
      .focus()
      .deleteRange({ from: startPos, to: from })
      .insertContent(`[[${title}]]`)
      .run()
    setWikiQuery(null)
  }

  async function handleSaveAndLeave() {
    setShowLeaveDialog(false)
    if (newMemoTimerRef.current) {
      clearTimeout(newMemoTimerRef.current)
      newMemoTimerRef.current = null
    }
    if (editorRef.current) {
      const json = editorRef.current.getJSON() as Record<string, unknown>
      const text = editorRef.current.getText()
      await saveRef.current(json, text, { skipNavigate: true })
    }
    const dest = pendingMemoId ? `/memo/${pendingMemoId}` : '/memo'
    setPendingMemoId(null)
    router.push(dest)
  }

  function handleSidePanelSelect(id: string) {
    if (hasUnsavedRef.current) {
      setPendingMemoId(id)
      setShowLeaveDialog(true)
    } else {
      router.push(`/memo/${id}`)
    }
  }

  async function handleToggleStar() {
    const newVal = !isStarred
    setIsStarred(newVal)
    const id = createdIdRef.current
    if (id) {
      await supabase.from('memos').update({ is_starred: newVal }).eq('id', id)
      queryClient.setQueryData<Memo[]>(memoKeys.all(),
        (old) => old?.map((m) => m.id === id ? { ...m, isStarred: newVal } : m))
    }
  }

  async function handleTogglePin() {
    const newVal = !isPinned
    setIsPinned(newVal)
    const id = createdIdRef.current
    if (id) {
      await supabase.from('memos').update({ is_pinned: newVal }).eq('id', id)
      queryClient.setQueryData<Memo[]>(memoKeys.all(),
        (old) => old?.map((m) => m.id === id ? { ...m, isPinned: newVal } : m))
    }
  }

  async function handleChangeFolder(newFolderId: string | null) {
    setFolderId(newFolderId)
    setShowFolderDropdown(false)
    const id = createdIdRef.current
    if (id) {
      await supabase.from('memos').update({ folder_id: newFolderId }).eq('id', id)
      queryClient.setQueryData<Memo[]>(memoKeys.all(),
        (old) => old?.map((m) => m.id === id ? { ...m, folderId: newFolderId } : m))
      queryClient.invalidateQueries({ queryKey: ['memo-folder-counts'] })
    }
  }

  function toggleFolderExpand(parentId: string) {
    setExpandedFolders((prev) => {
      const next = new Set(prev)
      if (next.has(parentId)) next.delete(parentId)
      else next.add(parentId)
      return next
    })
  }

  function handleManualSave() {
    if (!editor) return
    const json = editor.getJSON() as Record<string, unknown>
    const text = editor.getText()
    save(json, text)
  }

  function handleDelete() {
    const id = createdIdRef.current
    if (!id) return
    confirm.open({
      title: '메모를 휴지통으로 옮길까요?',
      description: '7일 후 자동으로 영구 삭제돼요.',
      variant: 'danger',
      confirmLabel: '휴지통으로',
      onConfirm: async () => {
        await supabase
          .from('memos')
          .update({ is_deleted: true, deleted_at: new Date().toISOString() })
          .eq('id', id)

        // 단일 전체 캐시에서 즉시 제거
        queryClient.setQueryData<import('@/types').Memo[]>(
          memoKeys.all(),
          (old) => old?.filter((m) => m.id !== id) ?? []
        )
        // 폴더 카운트 감소
        queryClient.setQueryData<Array<{ folder_id: string | null }>>(
          ['memo-folder-counts'],
          (old) => {
            if (!old) return old
            const idx = old.findIndex((r) => r.folder_id === folderIdRef.current)
            if (idx === -1) return old
            return [...old.slice(0, idx), ...old.slice(idx + 1)]
          }
        )
        queryClient.invalidateQueries({ queryKey: ['memo-folder-counts'] })

        // 홈 최근 메모 캐시도 즉시 제거 — useMemos.softDelete를 거치지 않고
        // 직접 DB update를 하므로 동일한 캐시 정리를 여기서도 수행
        queryClient.setQueryData<{ recentMemos: Array<{ id: string }> } | undefined>(
          ['home-memos'],
          (old) => old ? { ...old, recentMemos: old.recentMemos.filter((m) => m.id !== id) } : old,
        )
        queryClient.invalidateQueries({ queryKey: ['home-memos'] })
        if (typeof window !== 'undefined') {
          try {
            const raw = (() => { const k = lsHomeMemosCache(); return k ? localStorage.getItem(k) : null })()
            if (raw) {
              const parsed = JSON.parse(raw) as { recentMemos: Array<{ id: string }> }
              const next = { ...parsed, recentMemos: parsed.recentMemos.filter((m) => m.id !== id) }
              { const k = lsHomeMemosCache(); if (k) localStorage.setItem(k, JSON.stringify(next)) }
              { const k = lsHomeMemosCacheTs(); if (k) localStorage.setItem(k, String(Date.now())) }
            }
          } catch { /* ignore */ }
        }

        router.push('/memo')
      },
    })
  }

  function handleRestore(version: MemoVersion) {
    if (!editor) return
    editor.commands.setContent(version.content)
    setTitle(version.title)
    setShowHistory(false)
  }

  const readMinutes = Math.max(1, Math.ceil(charCount / 200))

  return (
    <div className="flex h-full bg-white dark:bg-gray-900">
      <div className="flex flex-col flex-1 min-w-0">
        {/* 상단 바 */}
        <div className="flex items-center justify-between px-3 md:px-8 py-1.5 md:py-2 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-2">
            <button
              onClick={handleBackToList}
              className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 px-2 py-1.5 rounded-lg transition-colors"
            >
              <ArrowLeft size={13} />
              <span>목록</span>
            </button>
            {fromGraph && (
              <button
                onClick={handleBackToGraph}
                title="그래프 뷰"
                className="flex items-center gap-1.5 text-xs text-violet-500 hover:text-violet-700 dark:hover:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-950/20 px-2 py-1.5 rounded-lg transition-colors"
              >
                <Network size={13} />
                <span className="hidden md:inline whitespace-nowrap">그래프 뷰</span>
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* 저장 상태 표시 — unsaved일 때 모바일에선 클릭 가능한 1-탭 저장 칩으로 변환.
               데스크탑은 기존 라벨 + 우측에 별도 저장 버튼 그대로. */}
            <div className="flex items-center gap-1.5 min-w-[20px] md:min-w-[80px] justify-end">
              {saveStatus === 'unsaved' && (
                <>
                  {/* 모바일: 탭 가능한 보라색 "저장" 칩 — 자동저장 1.5s 기다리지 않고 즉시 저장 */}
                  <button
                    onClick={handleManualSave}
                    aria-label="지금 저장"
                    className="md:hidden flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-md bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300 active:bg-violet-200 dark:active:bg-violet-900/60 transition-colors"
                  >
                    <Save size={11} />
                    저장
                  </button>
                  {/* 데스크탑: 기존 dot + 라벨 (별도 저장 버튼이 오른쪽에 있음) */}
                  <span className="hidden md:inline w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
                  <span className="hidden md:inline text-xs text-amber-500">저장 안 됨</span>
                </>
              )}
              {saveStatus === 'saving' && (
                <>
                  <span className="w-3 h-3 border border-violet-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                  <span className="hidden md:inline text-xs text-violet-400">저장 중...</span>
                </>
              )}
              {saveStatus === 'saved' && (
                <>
                  <span className="text-green-500 text-sm">✓</span>
                  <span className="hidden md:inline text-xs text-green-500">저장됨</span>
                </>
              )}
            </div>

            {/* 별표 버튼 */}
            <button
              onClick={handleToggleStar}
              title={isStarred ? '중요 해제' : '중요로 표시'}
              className="p-1.5 rounded transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              <Star
                size={15}
                className={isStarred ? 'text-amber-400 fill-amber-400' : 'text-gray-300 dark:text-gray-600'}
              />
            </button>

            {/* 핀 버튼 */}
            <button
              onClick={handleTogglePin}
              title={isPinned ? '고정 해제' : '고정'}
              className="p-1.5 rounded transition-colors hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              <Pin
                size={15}
                className={isPinned ? 'text-violet-500 fill-violet-500' : 'text-gray-300 dark:text-gray-600'}
              />
            </button>

            {/* 휴지통 버튼 — 데스크탑만 (모바일은 더보기 메뉴) */}
            {createdId && (
              <button
                onClick={handleDelete}
                title="휴지통으로 이동"
                className="hidden md:flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20"
              >
                <Trash2 size={12} />
                <span className="hidden md:inline">삭제</span>
              </button>
            )}

            {/* 수동 저장 버튼 — 데스크탑만 (모바일은 더보기 메뉴) */}
            <button
              onClick={handleManualSave}
              disabled={saveStatus === 'saving' || saveStatus === 'saved' || saveStatus === 'idle'}
              title="저장 (Ctrl+S)"
              className="hidden md:flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 disabled:cursor-default"
            >
              <Save size={12} />
              <span className="hidden md:inline">저장</span>
            </button>

            {/* 메모 목록 패널 토글 — 데스크탑만 */}
            <button
              onClick={() => setShowSidePanel((v) => {
                const next = !v
                if (typeof window !== 'undefined') localStorage.setItem('memoPanelOpen', String(next))
                return next
              })}
              title="메모 목록 패널"
              className={cn(
                'hidden md:inline-flex p-1.5 rounded transition-colors',
                showSidePanel
                  ? 'bg-violet-100 dark:bg-violet-900/40 text-violet-600'
                  : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
              )}
            >
              <PanelRight size={14} />
            </button>

            {createdId && (
              <button
                onClick={() => setShowHistory((v) => !v)}
                title="버전 이력"
                className={cn(
                  'hidden md:flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors',
                  showHistory
                    ? 'bg-violet-100 dark:bg-violet-900/40 text-violet-600'
                    : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                )}
              >
                <History size={13} />
                <span className="hidden md:inline">이력</span>
              </button>
            )}

            {/* 모바일 전용 더보기 메뉴 — 휴지통/저장/패널/이력 통합 */}
            <div className="md:hidden relative" ref={moreMenuRef}>
              <button
                onClick={() => setShowMoreMenu((v) => !v)}
                title="더보기"
                aria-label="더보기"
                className={cn(
                  'p-2 rounded transition-colors',
                  showMoreMenu
                    ? 'bg-violet-100 dark:bg-violet-900/40 text-violet-600'
                    : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'
                )}
              >
                <MoreVertical size={16} />
              </button>
              {showMoreMenu && (
                <div className="absolute top-full right-0 mt-1 w-44 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg overflow-hidden z-30 py-1">
                  <button
                    onClick={() => { setShowMoreMenu(false); handleManualSave() }}
                    disabled={saveStatus === 'saving' || saveStatus === 'saved' || saveStatus === 'idle'}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-left text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40 disabled:cursor-default transition-colors"
                  >
                    <Save size={14} className="text-gray-400" />
                    저장
                  </button>
                  {createdId && (
                    <button
                      onClick={() => { setShowMoreMenu(false); setShowHistory((v) => !v) }}
                      className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-left text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                    >
                      <History size={14} className="text-gray-400" />
                      버전 이력
                    </button>
                  )}
                  {createdId && (
                    <>
                      <div className="h-px bg-gray-100 dark:bg-gray-800 my-1" />
                      <button
                        onClick={() => { setShowMoreMenu(false); handleDelete() }}
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-left text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors"
                      >
                        <Trash2 size={14} />
                        휴지통으로 이동
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 폴더 선택 */}
        <div className="relative px-3 md:px-8 pt-3 md:pt-4">
          <button
            onClick={() => setShowFolderDropdown((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            {/* 데스크톱: 컬러 Folder 아이콘 */}
            <Folder
              size={12}
              className="hidden sm:inline-block flex-shrink-0"
              style={{ color: folderId
                ? `hsl(${folders.find((f) => f.id === folderId)?.colorH ?? 260}, ${folders.find((f) => f.id === folderId)?.colorS ?? 60}%, ${folders.find((f) => f.id === folderId)?.colorL ?? 80}%)`
                : 'currentColor'
              }}
            />
            {/* 모바일: 색상 동그라미 or 회색 Folder 아이콘 */}
            {folderId ? (
              <span
                className="sm:hidden w-3 h-3 rounded-full flex-shrink-0"
                style={{ background: `hsl(${folders.find((f) => f.id === folderId)?.colorH ?? 260}, ${folders.find((f) => f.id === folderId)?.colorS ?? 60}%, ${folders.find((f) => f.id === folderId)?.colorL ?? 80}%)` }}
              />
            ) : (
              <Folder size={12} className="sm:hidden" />
            )}
            {/* C. 현재 폴더 라벨 — 서브폴더면 "부모 / 자식" 경로 표시 */}
            <span>{(() => {
              if (!folderId) return '폴더 없음'
              const current = folders.find((f) => f.id === folderId)
              if (!current) return initialFolderName ?? '폴더'
              if (current.parentId) {
                const parent = folders.find((f) => f.id === current.parentId)
                return parent ? `${parent.name} / ${current.name}` : current.name
              }
              return current.name
            })()}</span>
            <ChevronDown size={10} />
          </button>
          {showFolderDropdown && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowFolderDropdown(false)} />
              {/* E. w-48 max-h-80 스크롤 */}
              <div className="absolute left-3 md:left-8 top-8 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg py-1 w-48 max-h-80 overflow-y-auto">
                {/* 폴더 없음 */}
                <button
                  onClick={() => handleChangeFolder(null)}
                  className={cn('w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors', !folderId ? 'text-violet-600 bg-violet-50 dark:bg-violet-950/20' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700')}
                >
                  <Folder size={12} /> 폴더 없음
                </button>
                {/* D. 부모 폴더 + Accordion 서브폴더 */}
                {folders.filter((f) => !f.parentId).map((parent) => {
                  const children = folders.filter((f) => f.parentId === parent.id)
                  const hasChildren = children.length > 0
                  const isExpanded = expandedFolders.has(parent.id)
                  return (
                    <div key={parent.id}>
                      {/* 부모 폴더 행 */}
                      <div className={cn(
                        'w-full flex items-center gap-1 px-2 py-1.5 text-xs transition-colors',
                        folderId === parent.id
                          ? 'text-violet-600 bg-violet-50 dark:bg-violet-950/20'
                          : 'text-gray-600 dark:text-gray-400'
                      )}>
                        {/* 화살표: 자식 있을 때만 표시, 클릭 시 펼침/접힘 */}
                        <button
                          onClick={(e) => { e.stopPropagation(); toggleFolderExpand(parent.id) }}
                          className={cn('flex-shrink-0 p-0.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors', !hasChildren && 'invisible')}
                        >
                          <ChevronRight size={10} className={cn('transition-transform', isExpanded && 'rotate-90')} />
                        </button>
                        {/* 폴더명: 클릭 시 폴더 선택 */}
                        <button
                          onClick={() => handleChangeFolder(parent.id)}
                          className="flex items-center gap-2 flex-1 text-left hover:bg-gray-50 dark:hover:bg-gray-700 rounded px-1 py-0.5 min-w-0"
                        >
                          {/* 데스크톱: Folder 아이콘 */}
                          <Folder size={12} className="hidden sm:inline-block flex-shrink-0" style={{ color: `hsl(${parent.colorH},${parent.colorS}%,${parent.colorL}%)` }} />
                          {/* 모바일: 색상 동그라미 */}
                          <span className="sm:hidden w-3 h-3 rounded-full flex-shrink-0" style={{ background: `hsl(${parent.colorH},${parent.colorS}%,${parent.colorL}%)` }} />
                          <span className="truncate">{parent.name}</span>
                        </button>
                      </div>
                      {/* 서브폴더 (펼쳤을 때만) */}
                      {isExpanded && children.map((child) => (
                        <button
                          key={child.id}
                          onClick={() => handleChangeFolder(child.id)}
                          className={cn(
                            'w-full flex items-center gap-2 pl-9 pr-3 py-1.5 text-xs text-left transition-colors',
                            folderId === child.id
                              ? 'text-violet-600 bg-violet-50 dark:bg-violet-950/20'
                              : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
                          )}
                        >
                          {/* 데스크톱: Folder 아이콘 */}
                          <Folder size={12} className="hidden sm:inline-block flex-shrink-0" style={{ color: `hsl(${child.colorH},${child.colorS}%,${child.colorL}%)` }} />
                          {/* 모바일: 색상 동그라미 */}
                          <span className="sm:hidden w-3 h-3 rounded-full flex-shrink-0" style={{ background: `hsl(${child.colorH},${child.colorS}%,${child.colorL}%)` }} />
                          <span className="truncate">{child.name}</span>
                        </button>
                      ))}
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>

        {/* 제목 — 모바일 autofill(비번/카드/주소 바) 억제:
             1) type="search" — 검색 필드는 브라우저·키보드(삼성 Pass 포함) autofill 비대상.
                앱 내 다른 입력들과 동일 패턴 (QuickCapture/PlanForm/FolderPanel/HomeClient).
                ※ autoComplete="new-password"는 크롬 팝업은 막지만 삼성 키보드에
                   password 힌트를 전달해 키/카드/위치 바를 오히려 소환 (재발 원인)
             2) data-autofill-preset="1" — AutofillBlocker가 속성을 덮어쓰지 않도록
             3) readOnly 토글 — 초기 render 시 크롬 heuristic 스캔 회피 (focus 시 해제)
             + data-no-focus-ring — globals.css :focus-visible outline 예외 처리 */}
        <input
          type="search"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onFocus={() => setTitleReadOnly(false)}
          placeholder="제목 없음"
          readOnly={titleReadOnly}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          data-1p-ignore="true"
          data-lpignore="true"
          data-bitwarden-ignore="true"
          data-form-type="other"
          data-autofill-preset="1"
          data-no-focus-ring="true"
          className="w-full px-3 md:px-8 pt-3 md:pt-4 pb-1.5 md:pb-2 text-2xl font-bold text-gray-900 dark:text-white bg-transparent outline-none placeholder-gray-300 dark:placeholder-gray-600"
        />

        {/* 툴바 */}
        {editor && <EditorToolbar editor={editor} />}
        <EditorBubbleMenu editor={editor} />

        {/* 에디터 */}
        <div
          className="flex-1 overflow-y-auto"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'))
            files.forEach(handleImageUpload)
          }}
          onPaste={(e) => {
            const items = Array.from(e.clipboardData.items)
            const imageItems = items.filter((i) => i.type.startsWith('image/'))
            if (imageItems.length === 0) return
            e.preventDefault()
            imageItems.forEach((item) => {
              const file = item.getAsFile()
              if (file) handleImageUpload(file)
            })
          }}
        >
          {/* 빈 메모 마크다운/슬래시 안내 — 한 번만 표시 */}
          {showMdHint && charCount === 0 && (
            <div className="px-3 md:px-8 pt-3">
              <div className="inline-flex flex-wrap items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-50/70 dark:bg-violet-950/30 border border-violet-100 dark:border-violet-900/40 text-xs text-violet-700 dark:text-violet-300">
                <span aria-hidden="true">💡</span>
                <span className="font-mono"><kbd className="font-sans">/</kbd> 블록 메뉴</span>
                <span className="opacity-40">·</span>
                <span className="font-mono"><kbd className="font-sans">#</kbd> 제목</span>
                <span className="opacity-40">·</span>
                <span className="font-mono"><kbd className="font-sans">-</kbd> 목록</span>
                <span className="opacity-40">·</span>
                <span className="font-mono"><kbd className="font-sans">[[</kbd> 위키</span>
                <span className="opacity-40">·</span>
                <span className="font-mono"><kbd className="font-sans">#태그</kbd></span>
                <button
                  type="button"
                  onClick={() => {
                    setShowMdHint(false)
                    try { window.localStorage.setItem('weave:md_hint_dismissed', '1') } catch {}
                  }}
                  aria-label="안내 닫기"
                  className="ml-1 opacity-50 hover:opacity-100 transition-opacity cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 rounded"
                >
                  ×
                </button>
              </div>
            </div>
          )}
          <EditorContent editor={editor} />
        </div>

        {/* 하단 푸터 */}
        <div className="flex items-center gap-3 px-3 md:px-8 py-1.5 md:py-2 border-t border-gray-100 dark:border-gray-800 text-xs text-gray-400 dark:text-gray-500">
          <span>{charCount.toLocaleString()}자</span>
          <span className="text-gray-200 dark:text-gray-700">|</span>
          <span>약 {readMinutes}분 분량</span>
          {taskStats.total > 0 && (
            <>
              <span className="text-gray-200 dark:text-gray-700">|</span>
              <span>체크리스트 {taskStats.done}/{taskStats.total} 완료</span>
            </>
          )}
          {savedAt && (
            <>
              <span className="text-gray-200 dark:text-gray-700">|</span>
              {/* tick dependency forces re-render for relative time */}
              <span key={tick}>마지막 수정: {formatRelativeTime(savedAt)}</span>
            </>
          )}
        </div>
      </div>

      {/* 우측 메모 목록 패널 */}
      {showSidePanel && (
        <MemoSidePanel
          currentMemoId={createdId ?? memoId}
          folderId={folderId}
          onSelect={handleSidePanelSelect}
          onClose={() => setShowSidePanel(false)}
        />
      )}

      {/* 버전 이력 패널 */}
      {showHistory && createdId && (
        <VersionHistory
          memoId={createdId}
          onRestore={handleRestore}
          onClose={() => setShowHistory(false)}
        />
      )}

      {/* 위키 자동완성 */}
      {wikiQuery !== null && (
        <WikiSuggest
          query={wikiQuery}
          position={wikiPos}
          onSelect={handleWikiSelect}
          onClose={() => setWikiQuery(null)}
        />
      )}

      {/* 태그 자동완성 */}
      {tagQuery !== null && (
        <TagSuggest
          query={tagQuery}
          position={tagPos}
          onSelect={handleTagSelect}
          onClose={() => setTagQuery(null)}
        />
      )}

      {/* 슬래시 명령 */}
      {slashQuery !== null && editor && (
        <SlashCommand
          editor={editor}
          query={slashQuery}
          position={slashPos}
          triggerFrom={slashFrom}
          onImageUpload={handleImageUpload}
          onClose={() => setSlashQuery(null)}
        />
      )}

      {showLeaveDialog && (
        <Modal
          onClose={() => setShowLeaveDialog(false)}
          ariaLabel="저장하지 않은 내용이 있어요"
          panelClassName="w-80 max-w-[92vw] p-6"
        >
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">저장하지 않은 내용이 있어요</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-5">저장하고 나가시겠어요?</p>
          <div className="flex flex-col gap-2">
            <button
              onClick={handleSaveAndLeave}
              autoFocus
              className="w-full py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded-lg transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 cursor-pointer"
            >
              저장하고 나가기
            </button>
            <button
              onClick={() => {
                const dest = pendingMemoId ? `/memo/${pendingMemoId}` : '/memo'
                setPendingMemoId(null)
                setShowLeaveDialog(false)
                router.push(dest)
              }}
              className="w-full py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 cursor-pointer"
            >
              그냥 나가기
            </button>
            <button
              onClick={() => setShowLeaveDialog(false)}
              className="w-full py-2 text-sm text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 cursor-pointer"
            >
              취소
            </button>
          </div>
        </Modal>
      )}
      <confirm.Render />
    </div>
  )
}
