'use client'

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

/**
 * Modal — 공통 모달 래퍼 (포커스 트랩 + Escape 닫기 + body 스크롤 잠금 + portal)
 *
 * 기존에 ColorWheelModal/LockModal/PlanFormModal/QuickCaptureModal 등이
 * `fixed inset-0 z-50` + stopPropagation을 각각 수동 구현하면서
 * - Escape 닫기 유무 불일치
 * - 포커스 트랩 부재 (Tab으로 모달 뒤 요소 접근 가능)
 * - z-index 임의값(z-50, z-[100], z-[110]) 충돌
 * 문제가 있던 것을 단일 컴포넌트로 통합.
 *
 * portal로 body에 직접 마운트 → 부모의 overflow/transform에 의한 잘림(clipping) 원천 차단.
 * z-index는 globals.css의 --z-modal 토큰 사용.
 */

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

interface ModalProps {
  onClose: () => void
  /** 스크린리더용 레이블 (필수) */
  ariaLabel: string
  children: React.ReactNode
  /** 패널 추가 클래스 (너비/패딩 등) */
  panelClassName?: string
  /** 배경 클릭으로 닫기. 기본 true */
  closeOnBackdrop?: boolean
  /** Escape로 닫기. 기본 true */
  closeOnEscape?: boolean
  /** 모바일에서 하단 시트 스타일 정렬 (items-end sm:items-center). 기본 false(중앙) */
  sheetOnMobile?: boolean
  /** 오버레이 추가 클래스 */
  overlayClassName?: string
}

export default function Modal({
  onClose,
  ariaLabel,
  children,
  panelClassName,
  closeOnBackdrop = true,
  closeOnEscape = true,
  sheetOnMobile = false,
  overlayClassName,
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)

  // 포커스 트랩 + Escape + 포커스 복원
  useEffect(() => {
    restoreFocusRef.current = document.activeElement as HTMLElement | null

    // 초기 포커스: [autofocus] 우선, 없으면 첫 포커스 가능한 요소, 그것도 없으면 패널 자체
    const panel = panelRef.current
    if (panel) {
      const auto = panel.querySelector<HTMLElement>('[autofocus]')
      const first = auto ?? panel.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
      if (first) first.focus()
      else { panel.tabIndex = -1; panel.focus() }
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && closeOnEscape) {
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      const p = panelRef.current
      if (!p) return
      const focusables = Array.from(p.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        .filter((el) => el.offsetParent !== null) // 화면에 보이는 것만
      if (focusables.length === 0) { e.preventDefault(); return }
      const firstEl = focusables[0]
      const lastEl = focusables[focusables.length - 1]
      const active = document.activeElement
      // Tab 순환: 마지막에서 Tab → 처음, 처음에서 Shift+Tab → 마지막
      if (!e.shiftKey && active === lastEl) { e.preventDefault(); firstEl.focus() }
      else if (e.shiftKey && (active === firstEl || active === p)) { e.preventDefault(); lastEl.focus() }
      else if (active && !p.contains(active)) { e.preventDefault(); firstEl.focus() }
    }

    document.addEventListener('keydown', onKeyDown, true)

    // body 스크롤 잠금
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.body.style.overflow = prevOverflow
      restoreFocusRef.current?.focus?.()
    }
  }, [onClose, closeOnEscape])

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      className={cn(
        'fixed inset-0 flex justify-center bg-black/40',
        sheetOnMobile ? 'items-end sm:items-center' : 'items-center p-4',
        overlayClassName,
      )}
      style={{ zIndex: 'var(--z-modal)' as unknown as number }}
      onClick={closeOnBackdrop ? onClose : undefined}
      aria-hidden="true"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        onClick={(e) => e.stopPropagation()}
        className={cn('bg-white dark:bg-gray-900 rounded-2xl shadow-xl', panelClassName)}
      >
        {children}
      </div>
    </div>,
    document.body,
  )
}
