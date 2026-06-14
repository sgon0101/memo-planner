'use client'

import { useState, useEffect, useRef, useLayoutEffect } from 'react'
import type { Editor } from '@tiptap/react'
import {
  Heading1, Heading2, Heading3, Pilcrow, List, ListOrdered, ListChecks,
  Quote, Code2, Minus, Table as TableIcon, Image as ImageIcon,
} from 'lucide-react'

/**
 * SlashCommand — Notion 스타일 블록 변환 메뉴
 *
 * 동작:
 *   - 빈 줄 또는 공백 뒤 `/` 입력 시 메뉴 표시 (MemoEditor onUpdate에서 트리거)
 *   - ↑↓ 화살표로 항목 이동, Enter로 선택, Esc로 닫기
 *   - 검색어로 항목 필터 (한국어 라벨 + 영어 키워드 모두)
 *
 * TagSuggest/WikiSuggest와 동일한 좌표·flip 패턴.
 */

interface Props {
  editor: Editor
  query: string
  position: { x: number; y: number }
  /** `/` 시작 위치 — onSelect 시 삭제 범위로 사용 */
  triggerFrom: number
  /** "이미지 업로드" 명령 선택 시 호출 (MemoEditor의 handleImageUpload 위임) */
  onImageUpload?: (file: File) => void
  onClose: () => void
}

interface Command {
  id: string
  label: string
  /** 검색 키워드(한·영) — 라벨 외에 매칭에 사용 */
  keywords: string[]
  icon: React.ReactNode
  /** editor.chain().focus().deleteRange({ from, to }).XXX().run() 형식 */
  run: (editor: Editor, from: number, to: number) => void
}

const COMMANDS: Command[] = [
  {
    id: 'h1',
    label: '제목 1',
    keywords: ['h1', 'heading1', 'title', '제목', '큰제목'],
    icon: <Heading1 size={15} />,
    run: (e, from, to) =>
      e.chain().focus().deleteRange({ from, to }).setNode('heading', { level: 1 }).run(),
  },
  {
    id: 'h2',
    label: '제목 2',
    keywords: ['h2', 'heading2', '제목', '중제목'],
    icon: <Heading2 size={15} />,
    run: (e, from, to) =>
      e.chain().focus().deleteRange({ from, to }).setNode('heading', { level: 2 }).run(),
  },
  {
    id: 'h3',
    label: '제목 3',
    keywords: ['h3', 'heading3', '제목', '소제목'],
    icon: <Heading3 size={15} />,
    run: (e, from, to) =>
      e.chain().focus().deleteRange({ from, to }).setNode('heading', { level: 3 }).run(),
  },
  {
    id: 'paragraph',
    label: '본문',
    keywords: ['paragraph', 'text', 'p', '본문', '텍스트', '단락'],
    icon: <Pilcrow size={15} />,
    run: (e, from, to) =>
      e.chain().focus().deleteRange({ from, to }).setParagraph().run(),
  },
  {
    id: 'bullet',
    label: '글머리표',
    keywords: ['bullet', 'list', 'ul', '글머리', '목록', '리스트'],
    icon: <List size={15} />,
    run: (e, from, to) =>
      e.chain().focus().deleteRange({ from, to }).toggleBulletList().run(),
  },
  {
    id: 'ordered',
    label: '번호 매기기',
    keywords: ['ordered', 'numbered', 'ol', '번호', '순서'],
    icon: <ListOrdered size={15} />,
    run: (e, from, to) =>
      e.chain().focus().deleteRange({ from, to }).toggleOrderedList().run(),
  },
  {
    id: 'task',
    label: '체크리스트',
    keywords: ['task', 'todo', 'check', 'checkbox', '체크', '할일', '투두'],
    icon: <ListChecks size={15} />,
    run: (e, from, to) =>
      e.chain().focus().deleteRange({ from, to }).toggleTaskList().run(),
  },
  {
    id: 'quote',
    label: '인용',
    keywords: ['quote', 'blockquote', '인용'],
    icon: <Quote size={15} />,
    run: (e, from, to) =>
      e.chain().focus().deleteRange({ from, to }).toggleBlockquote().run(),
  },
  {
    id: 'code',
    label: '코드 블록',
    keywords: ['code', 'codeblock', 'pre', '코드', '코드블록'],
    icon: <Code2 size={15} />,
    run: (e, from, to) =>
      e.chain().focus().deleteRange({ from, to }).toggleCodeBlock().run(),
  },
  {
    id: 'hr',
    label: '구분선',
    keywords: ['hr', 'divider', 'separator', 'rule', '구분', '구분선'],
    icon: <Minus size={15} />,
    run: (e, from, to) =>
      e.chain().focus().deleteRange({ from, to }).setHorizontalRule().run(),
  },
  {
    id: 'table',
    label: '표 (3×3)',
    keywords: ['table', '표', '테이블'],
    icon: <TableIcon size={15} />,
    run: (e, from, to) =>
      e.chain().focus().deleteRange({ from, to })
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run(),
  },
]

/** "이미지 업로드"는 onImageUpload prop이 필요해서 별도 처리 — 일반 Command 배열엔 포함하지 않고
 *  컴포넌트 내부에서 prop이 있을 때만 메뉴에 추가 */
const IMAGE_CMD_TEMPLATE: Omit<Command, 'run'> = {
  id: 'image',
  label: '이미지 업로드',
  keywords: ['image', 'img', 'picture', 'photo', '이미지', '사진', '그림'],
  icon: <ImageIcon size={15} />,
}

const DROPDOWN_MAX_HEIGHT = 360

export default function SlashCommand({ editor, query, position, triggerFrom, onImageUpload, onClose }: Props) {
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [flipUp, setFlipUp] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

  // 이미지 업로드 명령은 prop이 있을 때만 노출
  const allCommands: Command[] = onImageUpload
    ? [
        ...COMMANDS,
        {
          ...IMAGE_CMD_TEMPLATE,
          run: (e, from, to) => {
            e.chain().focus().deleteRange({ from, to }).run()
            const input = document.createElement('input')
            input.type = 'file'
            input.accept = 'image/*'
            input.onchange = (ev) => {
              const file = (ev.target as HTMLInputElement).files?.[0]
              if (file) onImageUpload(file)
            }
            input.click()
          },
        },
      ]
    : COMMANDS

  // 검색 필터
  const q = query.toLowerCase().trim()
  const filtered = !q
    ? allCommands
    : allCommands.filter((c) =>
        c.label.toLowerCase().includes(q) ||
        c.keywords.some((k) => k.toLowerCase().includes(q)),
      )

  // 검색어 변경 시 선택 인덱스 리셋
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 의도된 패턴 (TagSuggest와 동일)
  useEffect(() => { setSelectedIndex(0) }, [query])

  // viewport 가용 공간 측정 → 아래 부족하면 위로 flip
  useLayoutEffect(() => {
    function compute() {
      if (typeof window === 'undefined') return
      const spaceBelow = window.innerHeight - position.y
      const spaceAbove = position.y
      const estHeight = Math.min(DROPDOWN_MAX_HEIGHT, filtered.length * 36 + 16)
      setFlipUp(spaceBelow < estHeight && spaceAbove > estHeight)
    }
    compute()
    window.addEventListener('resize', compute)
    return () => window.removeEventListener('resize', compute)
  }, [position.y, filtered.length])

  function commitSelected() {
    const cmd = filtered[selectedIndex]
    if (!cmd) return
    const to = editor.state.selection.from
    cmd.run(editor, triggerFrom, to)
    onClose()
  }

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((i) => Math.max(i - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        commitSelected()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      } else if (e.key === 'Tab') {
        e.preventDefault()
        commitSelected()
      }
    }
    window.addEventListener('keydown', handler, { capture: true })
    return () => window.removeEventListener('keydown', handler, { capture: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- commitSelected는 선택 인덱스에 의존
  }, [filtered, selectedIndex])

  // 선택된 항목 시야 안으로
  useEffect(() => {
    itemRefs.current[selectedIndex]?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  if (filtered.length === 0) {
    return (
      <div
        className="fixed z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl px-4 py-3 text-xs text-gray-500"
        style={
          flipUp
            ? { left: position.x, top: position.y - 8, transform: 'translateY(-100%)' }
            : { left: position.x, top: position.y + 20 }
        }
      >
        매칭되는 명령이 없어요
      </div>
    )
  }

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label="블록 변환 명령"
      className="fixed z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl py-1 w-60 max-h-[360px] overflow-y-auto"
      style={
        flipUp
          ? { left: position.x, top: position.y - 8, transform: 'translateY(-100%)' }
          : { left: position.x, top: position.y + 20 }
      }
    >
      {filtered.map((cmd, i) => (
        <button
          key={cmd.id}
          ref={(el) => { itemRefs.current[i] = el }}
          role="option"
          aria-selected={i === selectedIndex}
          onMouseEnter={() => setSelectedIndex(i)}
          onMouseDown={(e) => { e.preventDefault(); setSelectedIndex(i); commitSelected() }}
          className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors cursor-pointer ${
            i === selectedIndex
              ? 'bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-300'
              : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50'
          }`}
        >
          <span className={`flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-md border border-gray-200 dark:border-gray-700 ${
            i === selectedIndex ? 'bg-white dark:bg-gray-800 text-violet-600 dark:text-violet-400' : 'text-gray-500 dark:text-gray-400'
          }`}>
            {cmd.icon}
          </span>
          <span className="flex-1 truncate">{cmd.label}</span>
        </button>
      ))}
    </div>
  )
}
