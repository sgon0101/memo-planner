'use client'

/**
 * 텍스트 선택 시 떠오르는 BubbleMenu — 자체 구현 (외부 extension 미사용).
 *
 * 모바일에서 텍스트를 선택하면 OS 네이티브 메뉴(잘라내기/복사 등)가 뜨면서
 * 우리 에디터 툴바를 가리는 문제가 있어, 선택된 텍스트 바로 옆에 작은 액션 바를
 * 띄워 글자색/형광/굵게 등을 즉시 적용할 수 있게 한다.
 *
 * - tiptap의 selection 이벤트로 표시/위치 갱신
 * - 선택이 비어있으면 숨김
 * - 선택 좌표는 getBoundingClientRect로 계산 (위쪽 우선, 공간 부족하면 아래)
 */

import { useEffect, useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { Editor } from '@tiptap/react'
import { Bold, Italic, Underline as UnderlineIcon, Highlighter, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

const QUICK_COLORS = [
  '#EF4444', // 빨강
  '#F97316', // 주황
  '#EAB308', // 노랑
  '#22C55E', // 초록
  '#3B82F6', // 파랑
  '#8B5CF6', // 보라
  '#000000', // 검정
]

const QUICK_HIGHLIGHTS = [
  '#FEF08A', // 노란
  '#BBF7D0', // 초록
  '#BAE6FD', // 하늘
  '#DDD6FE', // 보라
  '#FBCFE8', // 분홍
]

interface Props {
  editor: Editor | null
}

export default function EditorBubbleMenu({ editor }: Props) {
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)
  const [mode, setMode] = useState<'main' | 'color' | 'highlight'>('main')
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!editor) return

    function update() {
      if (!editor) return
      const { state } = editor
      const { from, to, empty } = state.selection
      // 선택 없거나 빈 경우 숨김
      if (empty || from === to) {
        setCoords(null)
        setMode('main')
        return
      }
      // 에디터 dom에서 선택 영역의 bounding rect
      try {
        const view = editor.view
        const startCoords = view.coordsAtPos(from)
        const endCoords = view.coordsAtPos(to)
        const top = Math.min(startCoords.top, endCoords.top)
        const left = (startCoords.left + endCoords.right) / 2
        // 메뉴 폭 추정 (조정은 마운트 후)
        const menuW = menuRef.current?.offsetWidth ?? 220
        const menuH = menuRef.current?.offsetHeight ?? 40
        let placeTop = top - menuH - 10
        // 위 공간 부족하면 아래로 (선택 영역 끝 + 12)
        if (placeTop < 60) {
          placeTop = Math.max(startCoords.bottom, endCoords.bottom) + 12
        }
        // 좌측 정렬 — 가운데 정렬 후 viewport 안으로 clamp
        let placeLeft = left - menuW / 2
        const margin = 8
        if (placeLeft < margin) placeLeft = margin
        if (placeLeft + menuW > window.innerWidth - margin) {
          placeLeft = window.innerWidth - menuW - margin
        }
        setCoords({ top: placeTop, left: placeLeft })
      } catch {
        setCoords(null)
      }
    }

    editor.on('selectionUpdate', update)
    editor.on('transaction', update)
    // 초기 + 외부 스크롤 보정
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)

    return () => {
      editor.off('selectionUpdate', update)
      editor.off('transaction', update)
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [editor])

  if (!editor || !coords || typeof window === 'undefined') return null

  function apply(fn: () => void) {
    fn()
    setMode('main')
  }

  return createPortal(
    <div
      ref={menuRef}
      onMouseDown={(e) => e.preventDefault()}
      className="fixed z-[300] flex items-center gap-0.5 px-1.5 py-1 bg-gray-900 dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-700/30"
      style={{ top: coords.top, left: coords.left }}
      role="toolbar"
      aria-label="텍스트 서식"
    >
      {mode === 'main' && (
        <>
          <BMBtn
            active={editor.isActive('bold')}
            onClick={() => apply(() => editor.chain().focus().toggleBold().run())}
            title="굵게"
          >
            <Bold size={15} />
          </BMBtn>
          <BMBtn
            active={editor.isActive('italic')}
            onClick={() => apply(() => editor.chain().focus().toggleItalic().run())}
            title="기울임"
          >
            <Italic size={15} />
          </BMBtn>
          <BMBtn
            active={editor.isActive('underline')}
            onClick={() => apply(() => editor.chain().focus().toggleUnderline().run())}
            title="밑줄"
          >
            <UnderlineIcon size={15} />
          </BMBtn>
          <div className="w-px h-5 bg-gray-700 mx-0.5" />
          <BMBtn onClick={() => setMode('color')} title="글자색">
            <span className="flex items-center gap-0.5">
              <span className="text-xs font-bold text-white">A</span>
              <span className="w-2.5 h-1 rounded-sm bg-violet-400" />
              <ChevronDown size={10} className="text-gray-400" />
            </span>
          </BMBtn>
          <BMBtn
            onClick={() => setMode('highlight')}
            active={editor.isActive('highlight')}
            title="형광펜"
          >
            <span className="flex items-center gap-0.5">
              <Highlighter size={14} />
              <ChevronDown size={10} className="text-gray-400" />
            </span>
          </BMBtn>
        </>
      )}

      {mode === 'color' && (
        <>
          {QUICK_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => apply(() => editor.chain().focus().setColor(c).run())}
              className="w-7 h-7 rounded-md border border-gray-700 hover:scale-110 active:scale-95 transition-transform"
              style={{ background: c }}
              aria-label={`색상 ${c}`}
            />
          ))}
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => apply(() => editor.chain().focus().unsetColor().run())}
            className="w-7 h-7 rounded-md border border-dashed border-gray-500 text-gray-300 text-[10px]"
            aria-label="색상 제거"
          >
            ×
          </button>
        </>
      )}

      {mode === 'highlight' && (
        <>
          {QUICK_HIGHLIGHTS.map((c) => (
            <button
              key={c}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => apply(() => editor.chain().focus().setHighlight({ color: c }).run())}
              className="w-7 h-7 rounded-md border border-gray-700 hover:scale-110 active:scale-95 transition-transform"
              style={{ background: c }}
              aria-label={`형광색 ${c}`}
            />
          ))}
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => apply(() => editor.chain().focus().unsetHighlight().run())}
            className="w-7 h-7 rounded-md border border-dashed border-gray-500 text-gray-300 text-[10px]"
            aria-label="형광 제거"
          >
            ×
          </button>
        </>
      )}
    </div>,
    document.body,
  )
}

function BMBtn({
  onClick, active, title, children,
}: {
  onClick: () => void
  active?: boolean
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      title={title}
      aria-label={title}
      className={cn(
        'flex items-center justify-center min-w-7 h-7 px-1.5 rounded-md transition-colors',
        active
          ? 'bg-violet-500/30 text-violet-200'
          : 'text-gray-200 hover:bg-gray-700 active:bg-gray-600',
      )}
    >
      {children}
    </button>
  )
}
