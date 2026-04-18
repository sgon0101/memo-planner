'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useEditor, EditorContent, ReactNodeViewRenderer } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import { Color } from '@tiptap/extension-color'
import { TextStyle } from '@tiptap/extension-text-style'
import Highlight from '@tiptap/extension-highlight'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { createLowlight, common } from 'lowlight'
import { History, Save, Star, Pin, ArrowLeft, PanelRight, Folder, ChevronDown, Network } from 'lucide-react'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { useMemoStore } from '@/store/memoStore'
import { useFolderStore } from '@/store/folderStore'
import { useVersions } from '@/hooks/useVersions'
import EditorToolbar from './EditorToolbar'
import VersionHistory from './VersionHistory'
import CodeBlockView from './CodeBlockView'
import MemoSidePanel from './MemoSidePanel'
import WikiSuggest from './WikiSuggest'
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
    linkedPlanIds: (row.linked_plan_ids as string[]) ?? [],
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

export default function MemoEditor({ memoId, initialTitle, initialContent, initialIsStarred = false, initialIsPinned = false, initialFolderId = null, isNew = false }: MemoEditorProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const fromGraph = searchParams.get('from') === 'graph'
  const supabase = createClient()
  const { setCurrentMemo, updateMemo, addMemo } = useMemoStore()
  const { folders } = useFolderStore()

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
  const [showLeaveDialog, setShowLeaveDialog] = useState(false)
  const [showSidePanel, setShowSidePanel] = useState(() => {
    if (typeof window === 'undefined') return true
    const saved = localStorage.getItem('memoPanelOpen')
    return saved !== 'false'
  })
  const [pendingMemoId, setPendingMemoId] = useState<string | null>(null)
  const [wikiQuery, setWikiQuery] = useState<string | null>(null)
  const [wikiPos, setWikiPos] = useState({ x: 0, y: 0 })

  const hasUnsavedRef = useRef(false)
  const titleRef = useRef(initialTitle)
  titleRef.current = title
  const createdIdRef = useRef<string | null>(isNew ? null : memoId)
  createdIdRef.current = createdId
  const lastVersionSavedAtRef = useRef<number>(0)
  const savedDisplayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const newMemoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { saveVersion } = useVersions(createdId)
  const saveVersionRef = useRef(saveVersion)
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
        await supabase.from('memos').update({
          title: titleRef.current,
          content,
          content_text: text,
          wiki_links: wikiLinks,
          updated_at: new Date().toISOString(),
        }).eq('id', id)
        updateMemo(id, { title: titleRef.current, content, contentText: text })

        const now = Date.now()
        if (now - lastVersionSavedAtRef.current > VERSION_COOLDOWN_MS) {
          lastVersionSavedAtRef.current = now
          saveVersionRef.current(content, text, titleRef.current).catch(console.error)
        }
      } else {
        const { data: { user } } = await supabase.auth.getUser()
        const { data, error } = await supabase
          .from('memos')
          .insert({
            user_id: user?.id,
            title: titleRef.current,
            content,
            content_text: text,
          })
          .select()
          .single()
        if (error) throw error
        const newMemo = toMemo(data)
        createdIdRef.current = newMemo.id
        setCreatedId(newMemo.id)
        setCurrentMemo(newMemo)
        addMemo(newMemo)
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
  }, [supabase, updateMemo, setCurrentMemo, addMemo, router])

  const saveRef = useRef(save)
  saveRef.current = save

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ codeBlock: false }),
      Underline,
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      Link.configure({ openOnClick: false }),
      Image,
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
        class: 'outline-none min-h-[calc(100vh-220px)] px-8 py-6 prose prose-sm dark:prose-invert max-w-none',
      },
    },
    onUpdate({ editor }) {
      hasUnsavedRef.current = true
      setSaveStatus('unsaved')
      const text = editor.getText()
      setCharCount(text.replace(/\s/g, '').length)
      setTaskStats(getTaskStats(editor.getJSON() as Record<string, unknown>))

      // wiki [[ 자동완성 감지
      const { state, view } = editor
      const { from } = state.selection
      const textBefore = state.doc.textBetween(Math.max(0, from - 50), from, '\n')
      const wikiMatch = textBefore.match(/\[\[([^\]]*)$/)
      if (wikiMatch) {
        const coords = view.coordsAtPos(from)
        setWikiQuery(wikiMatch[1])
        setWikiPos({ x: coords.left, y: coords.bottom })
      } else {
        setWikiQuery(null)
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

  function handleManualSave() {
    if (!editor) return
    const json = editor.getJSON() as Record<string, unknown>
    const text = editor.getText()
    save(json, text)
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
        <div className="flex items-center justify-between px-8 py-2 border-b border-gray-100 dark:border-gray-800">
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
                className="flex items-center gap-1.5 text-xs text-violet-500 hover:text-violet-700 dark:hover:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-950/20 px-2 py-1.5 rounded-lg transition-colors"
              >
                <Network size={13} />
                <span>그래프 뷰</span>
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* 저장 상태 표시 */}
            <div className="flex items-center gap-1.5 min-w-[80px] justify-end">
              {saveStatus === 'unsaved' && (
                <>
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
                  <span className="text-xs text-amber-500">저장 안 됨</span>
                </>
              )}
              {saveStatus === 'saving' && (
                <>
                  <span className="w-3 h-3 border border-violet-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
                  <span className="text-xs text-violet-400">저장 중...</span>
                </>
              )}
              {saveStatus === 'saved' && (
                <>
                  <span className="text-green-500 text-sm">✓</span>
                  <span className="text-xs text-green-500">저장됨</span>
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

            {/* 수동 저장 버튼 */}
            <button
              onClick={handleManualSave}
              disabled={saveStatus === 'saving' || saveStatus === 'saved' || saveStatus === 'idle'}
              title="저장 (Ctrl+S)"
              className="flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 disabled:cursor-default"
            >
              <Save size={12} />
              <span>저장</span>
            </button>

            {/* 메모 목록 패널 토글 */}
            <button
              onClick={() => setShowSidePanel((v) => {
                const next = !v
                if (typeof window !== 'undefined') localStorage.setItem('memoPanelOpen', String(next))
                return next
              })}
              title="메모 목록 패널"
              className={cn(
                'p-1.5 rounded transition-colors',
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
                  'flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors',
                  showHistory
                    ? 'bg-violet-100 dark:bg-violet-900/40 text-violet-600'
                    : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                )}
              >
                <History size={13} />
                <span>이력</span>
              </button>
            )}
          </div>
        </div>

        {/* 폴더 선택 */}
        <div className="relative px-8 pt-4">
          <button
            onClick={() => setShowFolderDropdown((v) => !v)}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            <Folder size={12} />
            <span>{folderId ? (folders.find((f) => f.id === folderId)?.name ?? '폴더') : '폴더 없음'}</span>
            <ChevronDown size={10} />
          </button>
          {showFolderDropdown && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowFolderDropdown(false)} />
              <div className="absolute left-8 top-8 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg py-1 w-44">
                <button
                  onClick={() => handleChangeFolder(null)}
                  className={cn('w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors', !folderId ? 'text-violet-600 bg-violet-50 dark:bg-violet-950/20' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700')}
                >
                  <Folder size={12} /> 폴더 없음
                </button>
                {folders.filter((f) => !f.parentId).map((f) => (
                  <button
                    key={f.id}
                    onClick={() => handleChangeFolder(f.id)}
                    className={cn('w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors', folderId === f.id ? 'text-violet-600 bg-violet-50 dark:bg-violet-950/20' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700')}
                  >
                    <Folder size={12} style={{ color: `hsl(${f.colorH},${f.colorS}%,${f.colorL}%)` }} />
                    {f.name}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* 제목 */}
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="제목 없음"
          className="w-full px-8 pt-4 pb-2 text-2xl font-bold text-gray-900 dark:text-white bg-transparent outline-none placeholder-gray-300 dark:placeholder-gray-600"
        />

        {/* 툴바 */}
        {editor && <EditorToolbar editor={editor} />}

        {/* 에디터 */}
        <div className="flex-1 overflow-y-auto">
          <EditorContent editor={editor} />
        </div>

        {/* 하단 푸터 */}
        <div className="flex items-center gap-3 px-8 py-2 border-t border-gray-100 dark:border-gray-800 text-xs text-gray-400 dark:text-gray-500">
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

      {/* 나가기 확인 다이얼로그 */}
      {/* 위키 자동완성 */}
      {wikiQuery !== null && (
        <WikiSuggest
          query={wikiQuery}
          position={wikiPos}
          onSelect={handleWikiSelect}
        />
      )}

      {showLeaveDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl p-6 w-80">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-2">저장하지 않은 내용이 있어요</h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-5">저장하고 나가시겠어요?</p>
            <div className="flex flex-col gap-2">
              <button
                onClick={handleSaveAndLeave}
                className="w-full py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded-lg transition-colors"
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
                className="w-full py-2 text-sm text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              >
                그냥 나가기
              </button>
              <button
                onClick={() => setShowLeaveDialog(false)}
                className="w-full py-2 text-sm text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
