'use client'

import { useEffect, useRef, useCallback, useState, useLayoutEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { memoKeys, useMemos } from '@/hooks/useMemos'
import { useEditor, EditorContent, ReactNodeViewRenderer } from '@tiptap/react'
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
  const { setCurrentMemo, updateMemo, addMemo, deleteMemo } = useMemoStore()
  const { folders } = useFolders()
  useMemos(undefined) // 전체 메모 캐시 사전 로드 → MemoSidePanel 즉각 표시

  const [title, setTitle] = useState(initialTitle)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
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
        await supabase.from('memos').update({
          title: titleRef.current,
          content,
          content_text: text,
          wiki_links: wikiLinks,
          tags,
          updated_at: updatedAt,
          thumbnail_url: thumbnailUrl,
        }).eq('id', id)

        // 목록 캐시에는 content 제외 — 에디터는 직접 DB fetch
        const patch = { title: titleRef.current, contentText: text, updatedAt, thumbnailUrl, tags, wikiLinks }
        updateMemo(id, patch)
        queryClient.setQueryData<Memo[]>(
          memoKeys.all(),
          (old) => old?.map((m) => m.id === id ? { ...m, ...patch } : m)
        )

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
        const { data: { user } } = await supabase.auth.getUser()
        const { data, error } = await supabase
          .from('memos')
          .insert({
            user_id: user?.id,
            title: titleRef.current,
            content,
            content_text: text,
            tags: extractTags(text),
            wiki_links: extractWikiLinks(text),
            folder_id: folderIdRef.current,
          })
          .select()
          .single()
        if (error) throw error
        const newMemo = toMemo(data)
        createdIdRef.current = newMemo.id
        setCreatedId(newMemo.id)

        // 새 메모 임베딩 fire-and-forget
        void fetch('/api/embeddings/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ memoId: newMemo.id }),
        }).catch(() => { /* 임베딩 실패는 silent */ })
        setCurrentMemo(newMemo)
        addMemo(newMemo)

        // 목록 캐시에는 content 제외 — 에디터는 직접 DB fetch
        const newMemoForCache = { ...newMemo, content: {} as Record<string, unknown> }
        queryClient.setQueryData<Memo[]>(
          memoKeys.all(),
          (old) => old ? [newMemoForCache, ...old] : [newMemoForCache]
        )
        // 폴더 카운트 즉시 반영
        const targetFolderId = folderIdRef.current
        queryClient.setQueryData<Array<{ folder_id: string | null }>>(
          ['memo-folder-counts'],
          (old) => old ? [...old, { folder_id: targetFolderId }] : [{ folder_id: targetFolderId }]
        )
        queryClient.invalidateQueries({ queryKey: ['memo-folder-counts'] })

        if (!skipNavigate) {
          router.replace(`/memo/${newMemo.id}`)
        }
      }

      hasUnsavedRef.current = false
      setSaveStatus('saved')
      setSavedAt(new Date())

      if (savedDisplayTimerRef.current) clearTimeout(savedDisplayTimerRef.current)
      savedDisplayTimerRef.current = setTimeout(() => setSaveStatus('idle'), SAVED_DISPLAY_MS)
    } catch (e) {
      console.error('저장 실패:', e)
      setSaveStatus('unsaved')
    }
  }, [supabase, queryClient, updateMemo, setCurrentMemo, addMemo, router])

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

  // Ctrl+S 저장
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
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

  async function handleImageUpload(file: File) {
    if (!editor) return
    const formData = new FormData()
    formData.append('file', file)
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: formData })
      if (!res.ok) throw new Error('업로드 실패')
      const { url, thumbnailUrl, mediumUrl, savedPercent, originalSize, compressedSize } = await res.json()
      editor.chain().focus().insertContent({
        type: 'image',
        attrs: {
          src: url,
          srcMd: mediumUrl ?? null,
          srcSm: thumbnailUrl ?? null,
          width: '50%',
        },
      }).run()
      const orig = (originalSize / 1024 / 1024).toFixed(1)
      const comp = (compressedSize / 1024 / 1024).toFixed(1)
      if (savedPercent > 0) {
        showUploadToast(`이미지가 ${savedPercent}% 압축됐어요 (${orig}MB → ${comp}MB)`)
      } else {
        showUploadToast('이미지가 업로드됐어요')
      }
    } catch {
      // 폴백: base64 삽입
      const reader = new FileReader()
      reader.onload = () => { editor.chain().focus().insertContent({ type: 'image', attrs: { src: reader.result as string, width: '50%' } }).run() }
      reader.readAsDataURL(file)
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
      updateMemo(id, { isStarred: newVal })
    }
  }

  async function handleTogglePin() {
    const newVal = !isPinned
    setIsPinned(newVal)
    const id = createdIdRef.current
    if (id) {
      await supabase.from('memos').update({ is_pinned: newVal }).eq('id', id)
      updateMemo(id, { isPinned: newVal })
    }
  }

  async function handleChangeFolder(newFolderId: string | null) {
    setFolderId(newFolderId)
    setShowFolderDropdown(false)
    const id = createdIdRef.current
    if (id) {
      await supabase.from('memos').update({ folder_id: newFolderId }).eq('id', id)
      updateMemo(id, { folderId: newFolderId })
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
        deleteMemo(id)
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
            {/* 저장 상태 표시 */}
            <div className="flex items-center gap-1.5 min-w-[20px] md:min-w-[80px] justify-end">
              {saveStatus === 'unsaved' && (
                <>
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
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

        {/* 제목 */}
        <input
          type="search"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="제목 없음"
          autoComplete="new-password"
          autoCorrect="off"
          spellCheck={false}
          data-1p-ignore="true"
          data-lpignore="true"
          data-bitwarden-ignore="true"
          data-form-type="other"
          className="w-full [&::-webkit-search-cancel-button]:hidden px-3 md:px-8 pt-3 md:pt-4 pb-1.5 md:pb-2 text-2xl font-bold text-gray-900 dark:text-white bg-transparent outline-none placeholder-gray-300 dark:placeholder-gray-600"
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
