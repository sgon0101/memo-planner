'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link2, Unlink, ExternalLink } from 'lucide-react'

/**
 * LinkInputPopover — window.prompt 대체용 인라인 링크 입력기
 *
 * 동작:
 *   - anchorRect 기준 portal로 띄우고 viewport flip
 *   - Enter 적용, Esc 취소, 외부 클릭 닫힘
 *   - prevHref가 있으면 "링크 제거" 버튼 노출
 *   - https:// prefix 자동 추가 (사용자가 도메인만 입력해도 OK)
 */

interface Props {
  /** 트리거 버튼의 getBoundingClientRect() */
  anchorRect: DOMRect
  initialUrl?: string
  /** 현재 텍스트에 이미 링크가 있으면 true → 제거 버튼 노출 */
  hasExistingLink?: boolean
  onApply: (url: string) => void
  onRemove?: () => void
  onClose: () => void
}

const POPOVER_W = 320

export default function LinkInputPopover({
  anchorRect, initialUrl = '', hasExistingLink, onApply, onRemove, onClose,
}: Props) {
  const [url, setUrl] = useState(initialUrl)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  // 위치 계산 + flip
  useLayoutEffect(() => {
    function calc() {
      const vw = window.innerWidth
      const vh = window.innerHeight
      const ph = popoverRef.current?.offsetHeight ?? 100
      let top = anchorRect.bottom + 6
      if (top + ph > vh - 8) top = anchorRect.top - ph - 6 // flip up
      let left = anchorRect.left
      if (left + POPOVER_W > vw - 8) left = vw - POPOVER_W - 8
      if (left < 8) left = 8
      setPos({ top, left })
    }
    calc()
    const raf = requestAnimationFrame(calc) // size 확정 후 재계산
    window.addEventListener('resize', calc)
    window.addEventListener('scroll', calc, true)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', calc)
      window.removeEventListener('scroll', calc, true)
    }
  }, [anchorRect])

  // 첫 포커스
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  // 외부 클릭 / Esc 닫기
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      const t = e.target as Node
      if (popoverRef.current?.contains(t)) return
      onClose()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.stopPropagation(); onClose() }
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  function normalize(raw: string): string {
    const v = raw.trim()
    if (!v) return ''
    // 이미 프로토콜이 있으면 그대로
    if (/^[a-z][a-z0-9+\-.]*:\/\//i.test(v)) return v
    // 메일이면 mailto:
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return `mailto:${v}`
    // 그 외는 https:// 자동
    return `https://${v}`
  }

  function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault()
    const normalized = normalize(url)
    if (!normalized) return
    onApply(normalized)
    onClose()
  }

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      ref={popoverRef}
      role="dialog"
      aria-label="링크 입력"
      style={{
        position: 'fixed',
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        width: POPOVER_W,
        zIndex: 200,
        visibility: pos ? 'visible' : 'hidden',
      }}
      className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl p-3 modal-panel-enter"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-2">
        <label className="flex items-center gap-2 text-xs font-medium text-gray-600 dark:text-gray-300">
          <Link2 size={13} className="text-violet-500" />
          <span>링크 URL</span>
        </label>
        <input
          ref={inputRef}
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com 또는 example.com"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          data-1p-ignore="true"
          data-lpignore="true"
          data-bitwarden-ignore="true"
          data-form-type="other"
          className="w-full px-2.5 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
        />
        <div className="flex items-center justify-between gap-2 mt-1">
          <div className="flex items-center gap-1">
            {hasExistingLink && onRemove && (
              <button
                type="button"
                onClick={() => { onRemove(); onClose() }}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-md transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500"
              >
                <Unlink size={11} /> 제거
              </button>
            )}
            {url && normalize(url) && (
              <a
                href={normalize(url)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors cursor-pointer"
              >
                <ExternalLink size={11} /> 열기
              </a>
            )}
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onClose}
              className="px-2.5 py-1 text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
            >
              취소
            </button>
            <button
              type="submit"
              disabled={!url.trim()}
              className="px-2.5 py-1 text-xs font-medium text-white bg-violet-600 hover:bg-violet-700 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500"
            >
              적용
            </button>
          </div>
        </div>
      </form>
    </div>,
    document.body,
  )
}
