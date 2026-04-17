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
import { createClient } from '@/lib/supabase/client'
import { useMemoStore } from '@/store/memoStore'
import EditorToolbar from './EditorToolbar'
import type { Memo } from '@/types'

const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] }

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

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const titleRef = useRef(initialTitle)
  titleRef.current = title

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
      } else {
        // 신규 메모 생성
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
  }, [createdId, supabase, updateMemo, setCurrentMemo, router])

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

  // 타이틀 변경 시 자동 저장 예약
  useEffect(() => {
    if (!editor) return
    scheduleSave(editor.getJSON() as Record<string, unknown>, editor.getText())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title])

  // 언마운트 시 남은 저장 처리
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [])

  const statusText = {
    saved: '저장됨',
    saving: '저장 중...',
    unsaved: '저장 안 됨',
  }[saveStatus]

  const statusColor = {
    saved: 'text-gray-400',
    saving: 'text-violet-400',
    unsaved: 'text-amber-400',
  }[saveStatus]

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900">
      {/* 상단 바 */}
      <div className="flex items-center justify-between px-8 py-2 border-b border-gray-100 dark:border-gray-800">
        <button
          onClick={() => router.push('/memo')}
          className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
        >
          ← 메모 목록
        </button>
        <span className={`text-xs ${statusColor} transition-colors`}>{statusText}</span>
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
  )
}
