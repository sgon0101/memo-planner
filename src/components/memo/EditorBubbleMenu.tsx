'use client'

/**
 * 텍스트 선택 시 떠오르는 BubbleMenu — 자체 구현
 *
 * 모바일 텍스트 선택 시 OS 네이티브 메뉴가 우리 툴바를 가리는 문제 해결.
 * 선택된 텍스트 근처에 작은 액션 바를 띄워 색·형광·굵게 즉시 적용.
 *
 * 트리거 — 다중:
 *  1. editor.on('selectionUpdate') / 'transaction'  (ProseMirror 내부)
 *  2. document 'selectionchange'  (브라우저 전역 — 모바일에서 가장 안정)
 *
 * 위치 — window.getSelection().getRangeAt(0).getBoundingClientRect() 사용
 *  (ProseMirror coordsAtPos는 모바일에서 부정확한 경우가 있어 브라우저 range 우선)
 */

import { useEffect, useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import type { Editor } from '@tiptap/react'
import { Bold, Italic, Underline as UnderlineIcon, Highlighter, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

const QUICK_COLORS = [
  '#EF4444', '#F97316', '#EAB308', '#22C55E', '#3B82F6', '#8B5CF6', '#000000',
]

const QUICK_HIGHLIGHTS = [
  '#FEF08A', '#BBF7D0', '#BAE6FD', '#DDD6FE', '#FBCFE8',
]

interface Props {
  editor: Editor | null
}

export default function EditorBubbleMenu({ editor }: Props) {
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)
  const [mode, setMode] = useState<'main' | 'color' | 'highlight'>('main')
  const menuRef = useRef<HTMLDivElement>(null)

  const recompute = useCallback(() => {
    if (!editor || typeof window === 'undefined') return
    // ★ 모바일 long-press 선택은 ProseMirror가 empty로 인식하는 경우가 많아
    //   브라우저 selection을 1차 진실로 사용 (ProseMirror 체크 제거)
    const winSel = window.getSelection()
    if (!winSel || winSel.rangeCount === 0) {
      setCoords(null)
      setMode('main')
      return
    }
    const text = winSel.toString()
    if (!text.trim()) {
      setCoords(null)
      setMode('main')
      return
    }
    const range = winSel.getRangeAt(0)
    // 선택 영역이 에디터 안에 있는지 확인 — 밖이면 무시
    const editorEl = editor.view.dom
    const container = range.commonAncestorContainer
    const containerEl = container.nodeType === Node.ELEMENT_NODE ? (container as Element) : container.parentElement
    if (!editorEl.contains(containerEl)) {
      setCoords(null)
      setMode('main')
      return
    }
    const rect = range.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) {
      setCoords(null)
      return
    }

    const menuW = menuRef.current?.offsetWidth ?? 280
    const menuH = menuRef.current?.offsetHeight ?? 44
    const isMobile = window.innerWidth < 768

    let top: number
    let left: number

    if (isMobile) {
      // ★ 모바일: 화면 하단 고정 — OS 네이티브 선택 메뉴(잘라내기/복사 등)는
      //   선택 위에 뜨므로, 우리 메뉴를 아래로 분리해 시각적 충돌 완전 해소.
      //   visualViewport 사용 → 키보드 올라오면 키보드 위에 자동 위치.
      const vv = window.visualViewport
      const vh = vv ? vv.height : window.innerHeight
      const vTop = vv ? vv.offsetTop : 0
      top = vTop + vh - menuH - 16
      left = (window.innerWidth - menuW) / 2
      const margin = 8
      if (left < margin) left = margin
      if (left + menuW > window.innerWidth - margin) {
        left = window.innerWidth - menuW - margin
      }
    } else {
      // 데스크탑: 선택 위에 (기존 동작)
      top = rect.top - menuH - 10
      if (top < 60) top = rect.bottom + 12
      left = rect.left + rect.width / 2 - menuW / 2
      const margin = 8
      if (left < margin) left = margin
      if (left + menuW > window.innerWidth - margin) {
        left = window.innerWidth - menuW - margin
      }
      if (top + menuH > window.innerHeight - margin) {
        top = window.innerHeight - menuH - margin
      }
    }
    setCoords({ top, left })
  }, [editor])

  useEffect(() => {
    if (!editor) return

    editor.on('selectionUpdate', recompute)
    editor.on('transaction', recompute)
    // 브라우저 selection 변화 — 모바일 long-press 선택 안정성 ↑
    document.addEventListener('selectionchange', recompute)
    window.addEventListener('resize', recompute)
    window.addEventListener('scroll', recompute, true)
    // 모바일 키보드 올라오면 visualViewport 변경 → 메뉴 위치 갱신
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', recompute)
      window.visualViewport.addEventListener('scroll', recompute)
    }

    // 초기 한 번
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 마운트 직후 위치 1회 계산 (측정 기반 배치)
    recompute()

    return () => {
      editor.off('selectionUpdate', recompute)
      editor.off('transaction', recompute)
      document.removeEventListener('selectionchange', recompute)
      window.removeEventListener('resize', recompute)
      window.removeEventListener('scroll', recompute, true)
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', recompute)
        window.visualViewport.removeEventListener('scroll', recompute)
      }
    }
  }, [editor, recompute])

  if (!editor || !coords || typeof window === 'undefined') return null

  function apply(fn: () => void) {
    fn()
    setMode('main')
  }

  return createPortal(
    <div
      ref={menuRef}
      // 선택 해제 방지 — mousedown/touchstart로 발화되는 선택 해제 막음
      onMouseDown={(e) => e.preventDefault()}
      onTouchStart={(e) => { /* 선택 유지 */ e.stopPropagation() }}
      className="fixed z-[300] flex items-center gap-0.5 px-1.5 py-1 bg-gray-900 dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-700/40"
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
              <span
                className="w-2.5 h-1 rounded-sm"
                style={{ background: (editor.getAttributes('textStyle').color as string | undefined) ?? 'currentColor' }}
              />
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
