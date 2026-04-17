'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useEditor, EditorContent } from '@tiptap/react'
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
import CodeBlock from '@tiptap/extension-code-block'
import { History } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useMemoStore } from '@/store/memoStore'
import { useVersions } from '@/hooks/useVersions'
import EditorToolbar from './EditorToolbar'
import VersionHistory from './VersionHistory'
import type { Memo, MemoVersion } from '@/types'

const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] }
const VERSION_COOLDOWN_MS = 5 * 60 * 1000 // 5분

type SaveStatus = 'saved' | 'saving' | 'unsaved'

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

export default function MemoEditor({ memoId, initialTitle, initialContent, isNew = false }: MemoEditorProps) {
  const router = useRouter()
  const supabase = createClient()
  const { setCurrentMemo, updateMemo } = useMemoStore()

  const [title, setTitle] = useState(initialTitle)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved')
  const [createdId, setCreatedId] = useState<string | null>(isNew ? null : memoId)
  const [showHistory, setShowHistory] = useState(false)

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastVersionSavedAtRef = useRef<number>(0)
  const titleRef = useRef(initialTitle)
  titleRef.current = title

  const { saveVersion } = useVersions(createdId)

  const save = useCallback(async (content: Record<string, unknown>, text: string) => {
    setSaveStatus('saving')
    try {
      if (createdId) {
        await supabase.from('memos').update({
          title: titleRef.current,
          content,
          content_text: text,
          updated_at: new Date().toISOString(),
        }).eq('id', createdId)
        updateMemo(createdId, { title: titleRef.current, content, contentText: text })

        // 5분 쿨다운으로 버전 저장
        const now = Date.now()
        if (now - lastVersionSavedAtRef.current > VERSION_COOLDOWN_MS) {
          lastVersionSavedAtRef.current = now
          saveVersion(content, text, titleRef.current).catch(console.error)
        }
      } else {
        const { data, error } = await supabase
          .from('memos')
          .insert({ title: titleRef.current, content, content_text: text })
          .select()
          .single()
        if (error) throw error
        const newMemo = toMemo(data)
        setCreatedId(newMemo.id)
        setCurrentMemo(newMemo)
        router.replace(`/memo/${newMemo.id}`)
      }
      setSaveStatus('saved')
    } catch (e) {
      console.error('저장 실패:', e)
      setSaveStatus('unsaved')
    }
  }, [createdId, supabase, updateMemo, setCurrentMemo, router, saveVersion])

  const scheduleSave = useCallback((content: Record<string, unknown>, text: string) => {
    setSaveStatus('unsaved')
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => save(content, text), 1500)
  }, [save])

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
      CodeBlock,
    ],
    content: Object.keys(initialContent).length > 0 ? initialContent : EMPTY_DOC,
    editorProps: {
      attributes: {
        class: 'outline-none min-h-[calc(100vh-180px)] px-8 py-6 prose prose-sm dark:prose-invert max-w-none',
      },
    },
    onUpdate({ editor }) {
      const json = editor.getJSON() as Record<string, unknown>
      const text = editor.getText()
      scheduleSave(json, text)
    },
  })

  useEffect(() => {
    if (!editor) return
    scheduleSave(editor.getJSON() as Record<string, unknown>, editor.getText())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title])

  useEffect(() => {
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }
  }, [])

  function handleRestore(version: MemoVersion) {
    if (!editor) return
    editor.commands.setContent(version.content)
    setTitle(version.title)
    setShowHistory(false)
  }

  const statusText = { saved: '저장됨', saving: '저장 중...', unsaved: '저장 안 됨' }[saveStatus]
  const statusColor = { saved: 'text-gray-400', saving: 'text-violet-400', unsaved: 'text-amber-400' }[saveStatus]

  return (
    <div className="flex h-full bg-white dark:bg-gray-900">
      <div className="flex flex-col flex-1 min-w-0">
        {/* 상단 바 */}
        <div className="flex items-center justify-between px-8 py-2 border-b border-gray-100 dark:border-gray-800">
          <button
            onClick={() => router.push('/memo')}
            className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            ← 메모 목록
          </button>
          <div className="flex items-center gap-3">
            <span className={`text-xs ${statusColor} transition-colors`}>{statusText}</span>
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
