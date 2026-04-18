'use client'

import { useState, useRef, useEffect } from 'react'
import { type Editor } from '@tiptap/react'
import {
  Bold, Italic, Underline, Strikethrough, Code,
  Heading1, Heading2, Heading3,
  List, ListOrdered, ListTodo,
  Quote, Code2, Minus,
  Link2, Table, Highlighter, Type,
  Undo2, Redo2, ChevronDown,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface ToolbarProps {
  editor: Editor
}

const TEXT_COLORS = [
  '#000000', '#374151', '#6B7280', '#EF4444', '#F97316',
  '#EAB308', '#22C55E', '#3B82F6', '#8B5CF6', '#EC4899',
]
const HIGHLIGHT_COLORS = [
  '#FEF08A', '#BBF7D0', '#BAE6FD', '#DDD6FE', '#FBCFE8',
  '#FED7AA', '#FECACA', '#E5E7EB', '#ffffff', '#000000',
]

function ToolBtn({
  onClick, active, disabled, title, children,
}: {
  onClick: () => void
  active?: boolean
  disabled?: boolean
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => { e.preventDefault(); onClick() }}
      disabled={disabled}
      title={title}
      className={cn(
        'flex items-center justify-center w-7 h-7 rounded text-sm transition-colors',
        active
          ? 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300'
          : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800',
        disabled && 'opacity-30 cursor-not-allowed'
      )}
    >
      {children}
    </button>
  )
}

function Divider() {
  return <div className="w-px h-5 bg-gray-200 dark:bg-gray-700 mx-0.5" />
}

function ColorPicker({
  colors, onSelect, title, children,
}: {
  colors: string[]
  onSelect: (color: string) => void
  title: string
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        title={title}
        onMouseDown={(e) => { e.preventDefault(); setOpen((v) => !v) }}
        className="flex items-center gap-0.5 h-7 px-1 rounded text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
      >
        {children}
        <ChevronDown size={10} />
      </button>
      {open && (
        <div className="absolute top-8 left-0 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg p-2 flex flex-wrap gap-1 w-36">
          {colors.map((c) => (
            <button
              key={c}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); onSelect(c); setOpen(false) }}
              className="w-6 h-6 rounded border border-gray-300 dark:border-gray-600 hover:scale-110 transition-transform"
              style={{ background: c }}
              title={c}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default function EditorToolbar({ editor }: ToolbarProps) {
  function setLink() {
    const prev = editor.getAttributes('link').href as string | undefined
    const url = window.prompt('링크 URL을 입력하세요', prev ?? 'https://')
    if (url === null) return
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
    }
  }

  function insertTable() {
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
  }

  return (
    <div className="flex items-center gap-0.5 px-3 py-1.5 border-b border-gray-200 dark:border-gray-800 overflow-x-auto scrollbar-none flex-wrap">
      {/* 히스토리 */}
      <ToolBtn onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} title="실행 취소 (Ctrl+Z)">
        <Undo2 size={14} />
      </ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} title="다시 실행 (Ctrl+Y)">
        <Redo2 size={14} />
      </ToolBtn>

      <Divider />

      {/* 헤딩 */}
      <ToolBtn onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive('heading', { level: 1 })} title="제목 1">
        <Heading1 size={14} />
      </ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })} title="제목 2">
        <Heading2 size={14} />
      </ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive('heading', { level: 3 })} title="제목 3">
        <Heading3 size={14} />
      </ToolBtn>

      <Divider />

      {/* 인라인 서식 */}
      <ToolBtn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="굵게 (Ctrl+B)">
        <Bold size={14} />
      </ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="기울임 (Ctrl+I)">
        <Italic size={14} />
      </ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} title="밑줄 (Ctrl+U)">
        <Underline size={14} />
      </ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')} title="취소선">
        <Strikethrough size={14} />
      </ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().toggleCode().run()} active={editor.isActive('code')} title="인라인 코드">
        <Code size={14} />
      </ToolBtn>

      <Divider />

      {/* 리스트 */}
      <ToolBtn onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="글머리 목록">
        <List size={14} />
      </ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="번호 목록">
        <ListOrdered size={14} />
      </ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().toggleTaskList().run()} active={editor.isActive('taskList')} title="할일 목록">
        <ListTodo size={14} />
      </ToolBtn>

      <Divider />

      {/* 블록 */}
      <ToolBtn onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive('blockquote')} title="인용">
        <Quote size={14} />
      </ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().toggleCodeBlock().run()} active={editor.isActive('codeBlock')} title="코드 블록">
        <Code2 size={14} />
      </ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().setHorizontalRule().run()} title="구분선">
        <Minus size={14} />
      </ToolBtn>

      <Divider />

      {/* 색상 */}
      <ColorPicker colors={TEXT_COLORS} onSelect={(c) => editor.chain().focus().setColor(c).run()} title="글자 색상">
        <Type size={13} />
      </ColorPicker>
      <ColorPicker
        colors={HIGHLIGHT_COLORS}
        onSelect={(c) =>
          c === '#ffffff'
            ? editor.chain().focus().unsetHighlight().run()
            : editor.chain().focus().setHighlight({ color: c }).run()
        }
        title="하이라이트"
      >
        <Highlighter size={13} />
      </ColorPicker>

      <Divider />

      {/* 삽입 */}
      <ToolBtn onClick={setLink} active={editor.isActive('link')} title="링크">
        <Link2 size={14} />
      </ToolBtn>
      <ToolBtn onClick={insertTable} title="표 삽입">
        <Table size={14} />
      </ToolBtn>
    </div>
  )
}
