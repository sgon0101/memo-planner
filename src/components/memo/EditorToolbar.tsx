'use client'

import { useState, useRef, useEffect } from 'react'
import { type Editor } from '@tiptap/react'
import {
  Bold, Italic, Underline, Strikethrough, Code,
  Heading1, Heading2, Heading3,
  List, ListOrdered, ListTodo,
  Quote, Code2, Minus,
  Link2, Highlighter, ImageIcon,
  Undo2, Redo2, ChevronDown, MoreHorizontal,
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
        'flex items-center justify-center w-8 h-8 rounded-lg text-sm transition-colors duration-150 cursor-pointer',
        active
          ? 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300'
          : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 hover:text-gray-700 dark:hover:text-gray-200',
        disabled && 'opacity-30 cursor-not-allowed',
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

// ── 모바일 전용 드롭다운 컴포넌트 ──────────────────────────────────

function HeadingPicker({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, () => setOpen(false))

  const activeLevel =
    editor.isActive('heading', { level: 1 }) ? 1 :
    editor.isActive('heading', { level: 2 }) ? 2 :
    editor.isActive('heading', { level: 3 }) ? 3 : null

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onMouseDown={(e) => { e.preventDefault(); setOpen((v) => !v) }}
        title="제목"
        className={cn(
          'flex items-center gap-0.5 h-8 px-2 rounded-lg transition-colors',
          activeLevel !== null
            ? 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300'
            : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
        )}
      >
        <span className="text-xs font-bold">H{activeLevel ?? ''}</span>
        <ChevronDown size={10} />
      </button>
      {open && (
        <div className="absolute top-9 left-0 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg py-1 w-32">
          {([1, 2, 3] as const).map((level) => {
            const isActive = editor.isActive('heading', { level })
            const Icon = level === 1 ? Heading1 : level === 2 ? Heading2 : Heading3
            return (
              <button
                key={level}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault()
                  editor.chain().focus().toggleHeading({ level }).run()
                  setOpen(false)
                }}
                className={cn(
                  'flex items-center justify-between w-full px-3 py-1.5 text-sm transition-colors',
                  isActive
                    ? 'bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-300'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                )}
              >
                <span className="flex items-center gap-2">
                  <Icon size={14} />
                  제목 {level}
                </span>
                {isActive && <span className="text-violet-500 text-xs">✓</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function TextStylePicker({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, () => setOpen(false))

  const isItalic = editor.isActive('italic')
  const isUnderline = editor.isActive('underline')
  const isStrike = editor.isActive('strike')
  const anyActive = isItalic || isUnderline || isStrike

  const TriggerIcon = isItalic ? Italic : isUnderline ? Underline : isStrike ? Strikethrough : Italic

  const options = [
    { key: 'italic',     label: '기울임', Icon: Italic,        action: () => editor.chain().focus().toggleItalic().run(),    isActive: isItalic },
    { key: 'underline',  label: '밑줄',   Icon: Underline,     action: () => editor.chain().focus().toggleUnderline().run(), isActive: isUnderline },
    { key: 'strike',     label: '취소선', Icon: Strikethrough, action: () => editor.chain().focus().toggleStrike().run(),    isActive: isStrike },
  ]

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onMouseDown={(e) => { e.preventDefault(); setOpen((v) => !v) }}
        title="텍스트 스타일"
        className={cn(
          'flex items-center gap-0.5 h-8 px-2 rounded-lg transition-colors',
          anyActive
            ? 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300'
            : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
        )}
      >
        <TriggerIcon size={14} />
        <ChevronDown size={10} />
      </button>
      {open && (
        <div className="absolute top-9 left-0 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg py-1 w-36">
          {options.map(({ key, label, Icon, action, isActive }) => (
            <button
              key={key}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); action(); setOpen(false) }}
              className={cn(
                'flex items-center justify-between w-full px-3 py-1.5 text-sm transition-colors',
                isActive
                  ? 'bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-300'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
              )}
            >
              <span className="flex items-center gap-2"><Icon size={14} />{label}</span>
              {isActive && <span className="text-violet-500 text-xs">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function ListPicker({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useClickOutside(ref, () => setOpen(false))

  const isActiveBullet   = editor.isActive('bulletList')
  const isActiveOrdered  = editor.isActive('orderedList')
  const isActiveTask     = editor.isActive('taskList')
  const anyActive        = isActiveBullet || isActiveOrdered || isActiveTask

  const ActiveIcon = isActiveOrdered ? ListOrdered : isActiveTask ? ListTodo : List

  const options = [
    { type: 'bulletList',   label: '글머리 목록', Icon: List,        action: () => editor.chain().focus().toggleBulletList().run(),   isActive: isActiveBullet },
    { type: 'orderedList',  label: '번호 목록',   Icon: ListOrdered, action: () => editor.chain().focus().toggleOrderedList().run(),  isActive: isActiveOrdered },
    { type: 'taskList',     label: '할일 목록',   Icon: ListTodo,    action: () => editor.chain().focus().toggleTaskList().run(),     isActive: isActiveTask },
  ]

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onMouseDown={(e) => { e.preventDefault(); setOpen((v) => !v) }}
        title="리스트"
        className={cn(
          'flex items-center gap-0.5 h-8 px-2 rounded-lg transition-colors',
          anyActive
            ? 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300'
            : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
        )}
      >
        <ActiveIcon size={14} />
        <ChevronDown size={10} />
      </button>
      {open && (
        <div className="absolute top-9 left-0 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg py-1 w-36">
          {options.map(({ type, label, Icon, action, isActive }) => (
            <button
              key={type}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); action(); setOpen(false) }}
              className={cn(
                'flex items-center justify-between w-full px-3 py-1.5 text-sm transition-colors',
                isActive
                  ? 'bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-300'
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
              )}
            >
              <span className="flex items-center gap-2"><Icon size={14} />{label}</span>
              {isActive && <span className="text-violet-500 text-xs">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

type MoreItem =
  | { divider: true }
  | { key: string; label: string; Icon: React.ComponentType<{ size?: number }> | null; customIcon?: boolean; action: () => void; isActive: boolean }

function MoreMenu({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false)

  const items: MoreItem[] = [
    { key: 'code',       label: '인라인 코드', Icon: Code,  action: () => editor.chain().focus().toggleCode().run(),         isActive: editor.isActive('code') },
    { divider: true },
    { key: 'blockquote', label: '인용',        Icon: Quote, action: () => editor.chain().focus().toggleBlockquote().run(),   isActive: editor.isActive('blockquote') },
    { key: 'codeBlock',  label: '코드 블록',   Icon: Code2, action: () => editor.chain().focus().toggleCodeBlock().run(),    isActive: editor.isActive('codeBlock') },
    { key: 'hr',         label: '구분선',       Icon: Minus, action: () => editor.chain().focus().setHorizontalRule().run(), isActive: false },
    { divider: true },
    { key: 'table',      label: '표 (3×3)',    Icon: null,  customIcon: true, action: () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(), isActive: false },
  ]

  return (
    <>
      <button
        type="button"
        onMouseDown={(e) => { e.preventDefault(); setOpen(true) }}
        title="더보기"
        className="flex items-center justify-center w-8 h-8 rounded-lg text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
      >
        <MoreHorizontal size={14} />
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          onMouseDown={(e) => { e.preventDefault(); setOpen(false) }}
        >
          <div
            className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg py-1 w-56"
            onMouseDown={(e) => e.stopPropagation()}
          >
            {items.map((item, i) => {
              if ('divider' in item) {
                return <div key={`d-${i}`} className="border-t border-gray-100 dark:border-gray-700 my-1" />
              }
              const { key, label, Icon, customIcon, action, isActive } = item
              return (
                <button
                  key={key}
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); action(); setOpen(false) }}
                  className={cn(
                    'flex items-center justify-between w-full px-3 py-2.5 text-sm transition-colors',
                    isActive
                      ? 'bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-300'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                  )}
                >
                  <span className="flex items-center gap-2">
                    {customIcon ? (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                        <line x1="3" y1="9" x2="21" y2="9" />
                        <line x1="3" y1="15" x2="21" y2="15" />
                        <line x1="9" y1="3" x2="9" y2="21" />
                        <line x1="15" y1="3" x2="15" y2="21" />
                      </svg>
                    ) : Icon ? (
                      <Icon size={14} />
                    ) : null}
                    {label}
                  </span>
                  {isActive && <span className="text-violet-500 text-xs">✓</span>}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </>
  )
}

// ── 메인 툴바 ──────────────────────────────────────────────────────

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

  async function handleImageFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setImageUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/upload', { method: 'POST', body: formData })
      if (!res.ok) throw new Error('업로드 실패')
      const { url } = await res.json()
      editor.chain().focus().insertContent({ type: 'image', attrs: { src: url, width: '50%' } }).run()
    } catch {
      const reader = new FileReader()
      reader.onload = () => { editor.chain().focus().insertContent({ type: 'image', attrs: { src: reader.result as string, width: '50%' } }).run() }
      reader.readAsDataURL(file)
    } finally {
      setImageUploading(false)
    }
  }

  return (
    <div className="flex items-center gap-0.5 px-3 py-1.5 border-b border-gray-200 dark:border-gray-800 flex-nowrap overflow-x-auto md:flex-wrap md:overflow-x-visible scrollbar-thin">
      {/* file input — 한 번만 정의 */}
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageFile} />

      {/* 히스토리 — 공통 */}
      <ToolBtn onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} title="실행 취소 (Ctrl+Z)">
        <Undo2 size={14} />
      </ToolBtn>
      <ToolBtn onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} title="다시 실행 (Ctrl+Y)">
        <Redo2 size={14} />
      </ToolBtn>

      <Divider />

      {/* 헤딩 — 데스크톱 평탄 / 모바일 드롭다운 */}
      <div className="hidden sm:flex items-center gap-0.5">
        <ToolBtn onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive('heading', { level: 1 })} title="제목 1">
          <Heading1 size={14} />
        </ToolBtn>
        <ToolBtn onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })} title="제목 2">
          <Heading2 size={14} />
        </ToolBtn>
        <ToolBtn onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive('heading', { level: 3 })} title="제목 3">
          <Heading3 size={14} />
        </ToolBtn>
      </div>
      <div className="sm:hidden">
        <HeadingPicker editor={editor} />
      </div>

      <Divider />

      {/* Bold — 공통 */}
      <ToolBtn onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')} title="굵게 (Ctrl+B)">
        <Bold size={14} />
      </ToolBtn>

      {/* Italic / Underline / Strike — 데스크톱 평탄 / 모바일 T 드롭다운 */}
      <div className="hidden sm:flex items-center gap-0.5">
        <ToolBtn onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')} title="기울임 (Ctrl+I)">
          <Italic size={14} />
        </ToolBtn>
        <ToolBtn onClick={() => editor.chain().focus().toggleUnderline().run()} active={editor.isActive('underline')} title="밑줄 (Ctrl+U)">
          <Underline size={14} />
        </ToolBtn>
        <ToolBtn onClick={() => editor.chain().focus().toggleStrike().run()} active={editor.isActive('strike')} title="취소선">
          <Strikethrough size={14} />
        </ToolBtn>
      </div>
      <div className="sm:hidden">
        <TextStylePicker editor={editor} />
      </div>

      {/* 인라인 코드 — 데스크톱만 (모바일은 더보기) */}
      <div className="hidden sm:flex">
        <ToolBtn onClick={() => editor.chain().focus().toggleCode().run()} active={editor.isActive('code')} title="인라인 코드">
          <Code size={14} />
        </ToolBtn>
      </div>

      <Divider />

      {/* 리스트 — 데스크톱 평탄 / 모바일 드롭다운 */}
      <div className="hidden sm:flex items-center gap-0.5">
        <ToolBtn onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive('bulletList')} title="글머리 목록">
          <List size={14} />
        </ToolBtn>
        <ToolBtn onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive('orderedList')} title="번호 목록">
          <ListOrdered size={14} />
        </ToolBtn>
        <ToolBtn onClick={() => editor.chain().focus().toggleTaskList().run()} active={editor.isActive('taskList')} title="할일 목록">
          <ListTodo size={14} />
        </ToolBtn>
      </div>
      <div className="sm:hidden">
        <ListPicker editor={editor} />
      </div>

      {/* 블록 (Quote / CodeBlock / HR) — 데스크톱만 (모바일은 더보기) */}
      <div className="hidden sm:flex items-center gap-0.5">
        <Divider />
        <ToolBtn onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive('blockquote')} title="인용">
          <Quote size={14} />
        </ToolBtn>
        <ToolBtn onClick={() => editor.chain().focus().toggleCodeBlock().run()} active={editor.isActive('codeBlock')} title="코드 블록">
          <Code2 size={14} />
        </ToolBtn>
        <ToolBtn onClick={() => editor.chain().focus().setHorizontalRule().run()} title="구분선">
          <Minus size={14} />
        </ToolBtn>
      </div>

      <Divider />

      {/* 색상 — 공통 */}
      <TextColorPicker editor={editor} />
      <HighlightPicker editor={editor} />

      <Divider />

      {/* 링크 — 공통 */}
      <ToolBtn onClick={setLink} active={editor.isActive('link')} title="링크">
        <Link2 size={14} />
      </ToolBtn>

      {/* 이미지 — 공통 */}
      <ToolBtn onClick={() => fileInputRef.current?.click()} disabled={imageUploading} title="이미지 삽입">
        {imageUploading ? (
          <span className="w-3.5 h-3.5 border border-violet-400 border-t-transparent rounded-full animate-spin" />
        ) : (
          <ImageIcon size={14} />
        )}
      </ToolBtn>

      {/* 표 — 데스크톱만 (모바일은 더보기) */}
      <div className="hidden sm:flex">
        <TablePicker onInsert={(rows, cols) => editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run()} />
      </div>

      {/* 더보기 — 모바일만 */}
      <div className="sm:hidden">
        <MoreMenu editor={editor} />
      </div>
    </div>
  )
}
