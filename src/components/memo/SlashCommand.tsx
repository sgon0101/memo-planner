'use client'

import { useState, useEffect, useRef, useLayoutEffect } from 'react'
import type { Editor } from '@tiptap/react'
import {
  Heading1, Heading2, Heading3, Pilcrow, List, ListOrdered, ListChecks,
  Quote, Code2, Minus, Table as TableIcon, Image as ImageIcon,
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  editor: Editor
  query: string
  position: { x: number; y: number }
  triggerFrom: number
  onImageUpload?: (file: File) => void
  onClose: () => void
}

interface Command {
  id: string
  label: string
  keywords: string[]
  icon: React.ReactNode
  run: (editor: Editor, from: number, to: number) => void
}

// 블록 변환 직전 marks/storedMarks 클리어 (이전 텍스트색이 새 입력에 적용되는 버그 방지)
function cleanChain(e: Editor, from: number, to: number) {
  return e.chain().focus().deleteRange({ from, to }).unsetAllMarks()
    .command(({ tr }) => { tr.setStoredMarks(null); return true })
}

const COMMANDS: Command[] = [
  { id: 'h1', label: '제목 1', keywords: ['h1', 'heading1', 'title', '제목', '큰제목'], icon: <Heading1 size={15} />,
    run: (e, f, t) => cleanChain(e, f, t).setNode('heading', { level: 1 }).run() },
  { id: 'h2', label: '제목 2', keywords: ['h2', 'heading2', '제목', '중제목'], icon: <Heading2 size={15} />,
    run: (e, f, t) => cleanChain(e, f, t).setNode('heading', { level: 2 }).run() },
  { id: 'h3', label: '제목 3', keywords: ['h3', 'heading3', '제목', '소제목'], icon: <Heading3 size={15} />,
    run: (e, f, t) => cleanChain(e, f, t).setNode('heading', { level: 3 }).run() },
  { id: 'paragraph', label: '본문', keywords: ['paragraph', 'text', 'p', '본문', '텍스트', '단락'], icon: <Pilcrow size={15} />,
    run: (e, f, t) => cleanChain(e, f, t).setParagraph().run() },
  { id: 'bullet', label: '글머리표', keywords: ['bullet', 'list', 'ul', '글머리', '목록', '리스트'], icon: <List size={15} />,
    run: (e, f, t) => cleanChain(e, f, t).toggleBulletList().run() },
  { id: 'ordered', label: '번호 매기기', keywords: ['ordered', 'numbered', 'ol', '번호', '순서'], icon: <ListOrdered size={15} />,
    run: (e, f, t) => cleanChain(e, f, t).toggleOrderedList().run() },
  { id: 'task', label: '체크리스트', keywords: ['task', 'todo', 'check', 'checkbox', '체크', '할일', '투두'], icon: <ListChecks size={15} />,
    run: (e, f, t) => cleanChain(e, f, t).toggleTaskList().run() },
  { id: 'quote', label: '인용', keywords: ['quote', 'blockquote', '인용'], icon: <Quote size={15} />,
    run: (e, f, t) => cleanChain(e, f, t).toggleBlockquote().run() },
  { id: 'code', label: '코드 블록', keywords: ['code', 'codeblock', 'pre', '코드', '코드블록'], icon: <Code2 size={15} />,
    run: (e, f, t) => cleanChain(e, f, t).toggleCodeBlock().run() },
  { id: 'hr', label: '구분선', keywords: ['hr', 'divider', 'separator', 'rule', '구분', '구분선'], icon: <Minus size={15} />,
    run: (e, f, t) => cleanChain(e, f, t).setHorizontalRule().run() },
  { id: 'table', label: '표 (3x3)', keywords: ['table', '표', '테이블'], icon: <TableIcon size={15} />,
    run: (e, f, t) => cleanChain(e, f, t).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
]

const IMAGE_TMPL: Omit<Command, 'run'> = {
  id: 'image', label: '이미지 업로드',
  keywords: ['image', 'img', 'picture', 'photo', '이미지', '사진', '그림'],
  icon: <ImageIcon size={15} />,
}

const MAX_H = 360

export default function SlashCommand({ editor, query, position, triggerFrom, onImageUpload, onClose }: Props) {
  const [idx, setIdx] = useState(0)
  const [flipUp, setFlipUp] = useState(false)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

  const all: Command[] = onImageUpload
    ? [...COMMANDS, { ...IMAGE_TMPL, run: (e, f, t) => {
        e.chain().focus().deleteRange({ from: f, to: t }).run()
        const input = document.createElement('input')
        input.type = 'file'; input.accept = 'image/*'
        input.onchange = (ev) => {
          const file = (ev.target as HTMLInputElement).files?.[0]
          if (file) onImageUpload(file)
        }
        input.click()
      } }]
    : COMMANDS

  const q = query.toLowerCase().trim()
  const filtered = !q ? all : all.filter((c) =>
    c.label.toLowerCase().includes(q) || c.keywords.some((k) => k.toLowerCase().includes(q)))

  // eslint-disable-next-line react-hooks/set-state-in-effect -- 검색어 변경 시 인덱스 리셋
  useEffect(() => { setIdx(0) }, [query])

  useLayoutEffect(() => {
    function compute() {
      if (typeof window === 'undefined') return
      const below = window.innerHeight - position.y
      const above = position.y
      const est = Math.min(MAX_H, filtered.length * 36 + 16)
      setFlipUp(below < est && above > est)
    }
    compute()
    window.addEventListener('resize', compute)
    return () => window.removeEventListener('resize', compute)
  }, [position.y, filtered.length])

  function commit() {
    const cmd = filtered[idx]
    if (!cmd) return
    cmd.run(editor, triggerFrom, editor.state.selection.from)
    onClose()
  }

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(i + 1, filtered.length - 1)) }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)) }
      else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); commit() }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose() }
    }
    window.addEventListener('keydown', handler, { capture: true })
    return () => window.removeEventListener('keydown', handler, { capture: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, idx])

  useEffect(() => { itemRefs.current[idx]?.scrollIntoView({ block: 'nearest' }) }, [idx])

  const styleProp = flipUp
    ? { left: position.x, top: position.y - 8, transform: 'translateY(-100%)' as const }
    : { left: position.x, top: position.y + 20 }

  if (filtered.length === 0) {
    return (
      <div className="fixed z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl px-4 py-3 text-xs text-gray-500" style={styleProp}>
        매칭되는 명령이 없어요
      </div>
    )
  }

  return (
    <div
      role="listbox"
      aria-label="블록 변환 명령"
      className="fixed z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl py-1 w-60 max-h-[360px] overflow-y-auto"
      style={styleProp}
    >
      {filtered.map((cmd, i) => {
        const sel = i === idx
        return (
          <button
            key={cmd.id}
            ref={(el) => { itemRefs.current[i] = el }}
            role="option"
            aria-selected={sel}
            onMouseEnter={() => setIdx(i)}
            onMouseDown={(e) => { e.preventDefault(); setIdx(i); commit() }}
            className={cn(
              'w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors cursor-pointer',
              sel
                ? 'bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-300'
                : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50',
            )}
          >
            <span
              className={cn(
                'flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-md border border-gray-200 dark:border-gray-700',
                sel
                  ? 'bg-white dark:bg-gray-800 text-violet-600 dark:text-violet-400'
                  : 'text-gray-500 dark:text-gray-400',
              )}
            >
              {cmd.icon}
            </span>
            <span className="flex-1 truncate">{cmd.label}</span>
          </button>
        )
      })}
    </div>
  )
}
