'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

/**
 * Menu — 공통 컨텍스트 메뉴 / 드롭다운 (Portal + auto-flip + 키보드 네비)
 *
 * 기존에 MemoList(1148), MemoCard CardMenu, FolderPanel(508), MemoEditor MoreMenu,
 * PlanDetailPanel 반복 삭제 메뉴 등이 각자 직접 구현하면서
 *   - 화면 모서리 overflow 처리 들쭉날쭉
 *   - 키보드 네비 부재
 *   - ESC/외부 클릭 닫힘 일부만
 *   - portal 미사용으로 부모 overflow:hidden에 잘림
 * 문제가 있던 것을 단일 패턴으로 통합.
 *
 * z-index: --z-modal 내부 dropdown(200) 토큰 — globals 정의에 따라 hardcoded fallback
 *
 * 사용 예:
 *   <Menu
 *     trigger={({ ref, open }) => (
 *       <button ref={ref} onClick={open}><MoreVertical /></button>
 *     )}
 *     items={[
 *       { label: '이름 변경', onClick: () => ... },
 *       { label: '색상 변경', onClick: () => ... },
 *       '-',
 *       { label: '삭제', onClick: () => ..., danger: true },
 *     ]}
 *     placement="bottom-end"
 *   />
 */

export type MenuItem =
  | '-'
  | {
      label: string
      onClick: () => void
      icon?: React.ReactNode
      danger?: boolean
      disabled?: boolean
      /** 우측 보조 텍스트 (단축키 등) */
      shortcut?: string
    }

export type MenuPlacement = 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end'

interface MenuProps {
  trigger: (api: {
    ref: React.RefObject<HTMLElement | null>
    open: () => void
    isOpen: boolean
  }) => React.ReactNode
  items: MenuItem[]
  placement?: MenuPlacement
  /** 메뉴 최소 너비 (px). 기본 160 */
  minWidth?: number
  /** 메뉴 추가 클래스 */
  menuClassName?: string
  /** 컨트롤드 모드 — 부모가 open 상태 관리 */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export default function Menu({
  trigger,
  items,
  placement = 'bottom-end',
  minWidth = 160,
  menuClassName,
  open: controlledOpen,
  onOpenChange,
}: MenuProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const isControlled = controlledOpen !== undefined
  const isOpen = isControlled ? controlledOpen : uncontrolledOpen

  function setOpen(v: boolean) {
    if (!isControlled) setUncontrolledOpen(v)
    onOpenChange?.(v)
  }

  const triggerRef = useRef<HTMLElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const [activeIndex, setActiveIndex] = useState<number>(-1)

  // selectable item만 (구분선 제외)
  const selectableIndices = items
    .map((it, i) => (it === '-' || it.disabled ? -1 : i))
    .filter((i) => i >= 0)

  // 위치 계산 — open 시 1회 + scroll/resize 시 재계산
  useLayoutEffect(() => {
    if (!isOpen) {
      setPosition(null)
      setActiveIndex(-1)
      return
    }

    function calc() {
      const trig = triggerRef.current
      const m = menuRef.current
      if (!trig) return

      const rect = trig.getBoundingClientRect()
      const mw = m?.offsetWidth ?? minWidth
      const mh = m?.offsetHeight ?? 200
      const vw = window.innerWidth
      const vh = window.innerHeight
      const margin = 8

      let top: number
      let left: number

      if (placement.startsWith('bottom')) {
        top = rect.bottom + 4
        if (top + mh > vh - margin) top = rect.top - mh - 4 // flip up
      } else {
        top = rect.top - mh - 4
        if (top < margin) top = rect.bottom + 4 // flip down
      }

      if (placement.endsWith('end')) {
        left = rect.right - mw
      } else {
        left = rect.left
      }

      // 화면 가장자리 clamp
      left = Math.max(margin, Math.min(left, vw - mw - margin))
      top = Math.max(margin, Math.min(top, vh - mh - margin))

      setPosition({ top, left })
    }

    calc()
    // 메뉴가 렌더된 후 한 번 더 (size 확정)
    const raf = requestAnimationFrame(calc)
    window.addEventListener('scroll', calc, true)
    window.addEventListener('resize', calc)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('scroll', calc, true)
      window.removeEventListener('resize', calc)
    }
  }, [isOpen, placement, minWidth])

  // 외부 클릭 / ESC 닫기
  useEffect(() => {
    if (!isOpen) return
    function onClick(e: MouseEvent) {
      const t = e.target as Node
      if (menuRef.current?.contains(t)) return
      if (triggerRef.current?.contains(t)) return
      setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); return }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        if (selectableIndices.length === 0) return
        const cur = selectableIndices.indexOf(activeIndex)
        const next =
          e.key === 'ArrowDown'
            ? selectableIndices[(cur + 1) % selectableIndices.length]
            : selectableIndices[(cur - 1 + selectableIndices.length) % selectableIndices.length]
        setActiveIndex(next)
        return
      }
      if (e.key === 'Enter' || e.key === ' ') {
        if (activeIndex >= 0) {
          e.preventDefault()
          const it = items[activeIndex]
          if (it !== '-' && !it.disabled) {
            it.onClick()
            setOpen(false)
          }
        }
        return
      }
      if (e.key === 'Home') { e.preventDefault(); if (selectableIndices.length) setActiveIndex(selectableIndices[0]) }
      if (e.key === 'End')  { e.preventDefault(); if (selectableIndices.length) setActiveIndex(selectableIndices[selectableIndices.length - 1]) }
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, activeIndex])

  return (
    <>
      {trigger({ ref: triggerRef, open: () => setOpen(!isOpen), isOpen })}
      {isOpen && typeof document !== 'undefined' && createPortal(
        <div
          ref={menuRef}
          role="menu"
          style={{
            position: 'fixed',
            top: position?.top ?? -9999,
            left: position?.left ?? -9999,
            minWidth,
            zIndex: 200, // modal 내부 dropdown 레이어
            visibility: position ? 'visible' : 'hidden',
          }}
          className={cn(
            'py-1 rounded-xl border shadow-lg',
            'bg-white dark:bg-gray-900',
            'border-gray-200 dark:border-gray-800',
            'modal-panel-enter',
            menuClassName,
          )}
        >
          {items.map((it, i) => {
            if (it === '-') {
              return <div key={`sep-${i}`} className="my-1 mx-2 border-t border-gray-200 dark:border-gray-800" />
            }
            const isActive = i === activeIndex
            return (
              <button
                key={i}
                role="menuitem"
                type="button"
                disabled={it.disabled}
                onMouseEnter={() => !it.disabled && setActiveIndex(i)}
                onClick={() => {
                  if (it.disabled) return
                  it.onClick()
                  setOpen(false)
                }}
                className={cn(
                  'w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left',
                  'transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed',
                  it.danger
                    ? 'text-red-600 dark:text-red-400'
                    : 'text-gray-700 dark:text-gray-200',
                  isActive && !it.disabled && (
                    it.danger
                      ? 'bg-red-50 dark:bg-red-950/40'
                      : 'bg-gray-100 dark:bg-gray-800'
                  ),
                )}
              >
                {it.icon && <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center">{it.icon}</span>}
                <span className="flex-1 truncate">{it.label}</span>
                {it.shortcut && (
                  <kbd className="text-[10px] text-gray-400 dark:text-gray-500 font-mono">{it.shortcut}</kbd>
                )}
              </button>
            )
          })}
        </div>,
        document.body,
      )}
    </>
  )
}
