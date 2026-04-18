'use client'

import { useState, useRef, useEffect } from 'react'
import { type Editor } from '@tiptap/react'
import {
  Bold, Italic, Underline, Strikethrough, Code,
  Heading1, Heading2, Heading3,
  List, ListOrdered, ListTodo,
  Quote, Code2, Minus,
  Link2, Highlighter, ImageIcon,
  Undo2, Redo2, ChevronDown,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface ToolbarProps {
  editor: Editor
}

const TEXT_COLORS = [
  '#000000', '#EF4444', '#F97316',
  '#EAB308', '#22C55E', '#3B82F6',
  '#8B5CF6', '#EC4899',
]

const HIGHLIGHT_OPTIONS = [
  { label: '노란색', color: '#FEF08A' },
  { label: '초록색', color: '#BBF7D0' },
  { label: '하늘색', color: '#BAE6FD' },
  { label: '보라색', color: '#DDD6FE' },
  { label: '분홍색', color: '#FBCFE8' },
]

function useClickOutside(ref: React.RefObject<HTMLElement | null>, handler: () => void) {
  useEffect(() => {
    function listener(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) handler()
    }
    document.addEventListener('mousedown', listener)
    return () => document.removeEventListener('mousedown', listener)
  }, [ref, handler])
}

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
  return <div className="w-px h-5 bg-gray-200 dark:bg-gray-700 mx-0.5 flex-shrink-0" />
}

function TextColorPicker({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false)
  const [customColor, setCustomColor] = useState('#000000')
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, () => setOpen(false))

  const currentColor = (editor.getAttributes('textStyle').color as string | undefined) ?? '#000000'

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onMouseDown={(e) => { e.preventDefault(); setOpen((v) => !v) }}
        title="글자 색상"
        className="flex flex-col items-center justify-center w-7 h-7 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
      >
        <span className="text-xs font-bold text-gray-700 dark:text-gray-300 leading-none">A</span>
        <span className="w-4 h-1 rounded-sm mt-0.5" style={{ background: currentColor }} />
      </button>
      {open && (
        <div className="absolute top-8 left-0 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg p-2.5 w-44">
          <div className="flex flex-wrap gap-1 mb-2">
            {TEXT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  editor.chain().focus().setColor(c).run()
                  setOpen(false)
                }}
                className="w-6 h-6 rounded border border-gray-300 dark:border-gray-600 hover:scale-110 transition-transform"
                style={{ background: c }}
                title={c}
              />
            ))}
          </div>
          <div className="flex items-center gap-1">
            <input
              type="color"
              value={customColor}
              onChange={(e) => setCustomColor(e.target.value)}
              className="w-7 h-7 rounded cursor-pointer border border-gray-300 dark:border-gray-600 p-0.5 bg-transparent"
            />
            <input
              type="text"
              value={customColor}
              onChange={(e) => setCustomColor(e.target.value)}
              placeholder="#000000"
              className="flex-1 text-xs px-1.5 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-violet-500"
            />
            <button
              onMouseDown={(e) => {
                e.preventDefault()
                editor.chain().focus().setColor(customColor).run()
                setOpen(false)
              }}
              className="text-xs px-2 py-1 bg-violet-600 text-white rounded hover:bg-violet-700"
            >
              적용
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function HighlightPicker({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, () => setOpen(false))

  const isActive = editor.isActive('highlight')

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onMouseDown={(e) => { e.preventDefault(); setOpen((v) => !v) }}
        title="형광펜"
        className={cn(
          'flex items-center gap-0.5 h-7 px-1 rounded transition-colors',
          isActive
            ? 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300'
            : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
        )}
      >
        <Highlighter size={13} />
        <ChevronDown size={10} />
      </button>
      {open && (
        <div className="absolute top-8 left-0 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg py-1 w-36">
          {HIGHLIGHT_OPTIONS.map((opt) => (
            <button
              key={opt.color}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault()
                editor.chain().focus().setHighlight({ color: opt.color }).run()
                setOpen(false)
              }}
              className="flex items-center gap-2 w-full px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-sm text-gray-700 dark:text-gray-300"
            >
              <span className="w-4 h-4 rounded flex-shrink-0" style={{ background: opt.color }} />
              {opt.label}
            </button>
          ))}
          <div className="border-t border-gray-100 dark:border-gray-700 mt-1 pt-1">
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault()
                editor.chain().focus().unsetHighlight().run()
                setOpen(false)
              }}
              className="flex items-center gap-2 w-full px-3 py-1.5 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-sm text-gray-400"
            >
              <span className="w-4 h-4 rounded border border-dashed border-gray-300 dark:border-gray-600 flex-shrink-0" />
              형광펜 제거
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function TablePicker({ onInsert }: { onInsert: (rows: number, cols: number) => void }) {
  const [open, setOpen] = useState(false)
  const [hovered, setHovered] = useState({ row: 0, col: 0 })
  const [manualRows, setManualRows] = useState('')
  const [manualCols, setManualCols] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, () => setOpen(false))

  const MAX = 8

  function doInsert(r: number, c: number) {
    onInsert(Math.max(1, r), Math.max(1, c))
    setOpen(false)
    setHovered({ row: 0, col: 0 })
    setManualRows('')
    setManualCols('')
  }

  return (
    <div className="relative" ref={ref}>
      <ToolBtn onClick={() => setOpen((v) => !v)} title="표 삽입" active={open}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="3" y1="9" x2="21" y2="9" />
          <line x1="3" y1="15" x2="21" y2="15" />
          <line x1="9" y1="3" x2="9" y2="21" />
          <line x1="15" y1="3" x2="15" y2="21" />
        </svg>
      </ToolBtn>
      {open && (
        <div className="absolute top-8 left-0 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg p-3">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2 min-w-[120px]">
            {hovered.row > 0 && hovered.col > 0
              ? `${hovered.row} × ${hovered.col} 표`
              : '표 크기 선택'}
          </p>
          <div
            className="grid gap-0.5"
            style={{ gridTemplateColumns: `repeat(${MAX}, 1fr)` }}
            onMouseLeave={() => setHovered({ row: 0, col: 0 })}
          >
            {Array.from({ length: MAX * MAX }).map((_, i) => {
              const r = Math.floor(i / MAX) + 1
              const c = (i % MAX) + 1
              const isHighlighted = r <= hovered.row && c <= hovered.col
              return (
                <div
                  key={i}
                  className={cn(
                    'w-5 h-5 border rounded-sm cursor-pointer transition-colors',
                    isHighlighted
                      ? 'bg-violet-200 dark:bg-violet-800 border-violet-400 dark:border-violet-500'
                      : 'bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-600'
                  )}
                  onMouseEnter={() => setHovered({ row: r, col: c })}
                  onMouseDown={(e) => { e.preventDefault(); doInsert(r, c) }}
                />
              )
            })}
          </div>
          <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-700 flex items-center gap-1">
            <input
              type="number" min={1} max={20}
              value={manualRows}
              onChange={(e) => setManualRows(e.target.value)}
              placeholder="행"
              className="w-12 text-xs px-1.5 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-violet-500"
            />
            <span className="text-xs text-gray-400">×</span>
            <input
              type="number" min={1} max={20}
              value={manualCols}
              onChange={(e) => setManualCols(e.target.value)}
              placeholder="열"
              className="w-12 text-xs px-1.5 py-1 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-violet-500"
            />
            <button
              onMouseDown={(e) => {
                e.preventDefault()
                doInsert(parseInt(manualRows) || 3, parseInt(manualCols) || 3)
              }}
              className="text-xs px-2 py-1 bg-violet-600 text-white rounded hover:bg-violet-700"
            >
              삽입
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function EditorToolbar({ editor }: ToolbarProps) {
  const [imageUploading, setImageUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

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

  function handleImageFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImageUploading(true)
    const reader = new FileReader()
    reader.onload = () => {
      const src = reader.result as string
      editor.chain().focus().setImage({ src }).run()
      setImageUploading(false)
    }
    reader.onerror = () => setImageUploading(false)
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  return (
    <div className="flex items-center gap-0.5 px-3 py-1.5 border-b border-gray-200 dark:border-gray-800 flex-wrap">
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
      <TextColorPicker editor={editor} />
      <HighlightPicker editor={editor} />

      <Divider />

      {/* 삽입 */}
      <ToolBtn onClick={setLink} active={editor.isActive('link')} title="링크">
        <Link2 size={14} />
      </ToolBtn>
      <TablePicker onInsert={(rows, cols) => editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run()} />

      {/* 이미지 업로드 */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleImageFile}
      />
      <ToolBtn
        onClick={() => fileInputRef.current?.click()}
        disabled={imageUploading}
        title="이미지 삽입"
      >
        {imageUploading ? (
          <span className="w-3.5 h-3.5 border border-violet-400 border-t-transparent rounded-full animate-spin" />
        ) : (
          <ImageIcon size={14} />
        )}
      </ToolBtn>
    </div>
  )
}
