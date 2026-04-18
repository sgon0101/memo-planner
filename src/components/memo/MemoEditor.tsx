'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
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
import { History, Save } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useMemoStore } from '@/store/memoStore'
import { useVersions } from '@/hooks/useVersions'
import EditorToolbar from './EditorToolbar'
import VersionHistory from './VersionHistory'
import CodeBlockView from './CodeBlockView'
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

export default function MemoEditor({ memoId, initialTitle, initialContent, isNew = false }: MemoEditorProps) {
  const router = useRouter()
  const supabase = createClient()
  const { setCurrentMemo, updateMemo, addMemo } = useMemoStore()

  const [title, setTitle] = useState(initialTitle)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [createdId, setCreatedId] = useState<string | null>(isNew ? null : memoId)
  const [showHistory, setShowHistory] = useState(false)
  const [charCount, setCharCount] = useState(0)
  const [taskStats, setTaskStats] = useState({ done: 0, total: 0 })
  const [savedAt, setSavedAt] = useState<Date | null>(null)
  const [tick, setTick] = useState(0)

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
        await supabase.from('memos').update({
          title: titleRef.current,
          content,
          content_text: text,
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

  async function handleBackToList() {
    if (newMemoTimerRef.current) {
      clearTimeout(newMemoTimerRef.current)
      newMemoTimerRef.current = null
    }
    if (hasUnsavedRef.current && editorRef.current) {
      const json = editorRef.current.getJSON() as Record<string, unknown>
      const text = editorRef.current.getText()
      if (text.trim() || titleRef.current.trim() || createdIdRef.current) {
        await saveRef.current(json, text, { skipNavigate: true })
      }
    }
    router.push('/memo')
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
          <button
            onClick={handleBackToList}
            className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            ← 메모 목록
          </button>
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

            {createdId && (
              <button
                onClick={() => setShowHistory((v) => !v)}
                title="버전 이력"
                className={`flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors ${
                  showHistory
                    ? 'bg-violet-100 dark:bg-violet-900/40 text-violet-600'
                    : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                }`}
              >
                <History size={13} />
                <span>이력</span>
              </button>
            )}
          </div>
        </div>

        {/* 제목 */}
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="제목 없음"
          className="w-full px-8 pt-8 pb-2 text-2xl font-bold text-gray-900 dark:text-white bg-transparent outline-none placeholder-gray-300 dark:placeholder-gray-600"
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

      {/* 버전 이력 패널 */}
      {showHistory && createdId && (
        <VersionHistory
          memoId={createdId}
          onRestore={handleRestore}
          onClose={() => setShowHistory(false)}
        />
      )}
    </div>
  )
}
