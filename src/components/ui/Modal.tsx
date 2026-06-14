'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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
 *
 * 2026-06-12 보강:
 * - 진입/퇴장 애니메이션 (modal-overlay-*, modal-panel-*, modal-sheet-*) — globals.css
 * - dirty prop — 진입 폼이 수정됐을 때 backdrop 클릭/Escape 시 confirm 다이얼로그
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
  /** 입력이 변경된 상태 — 닫기 시 사용자에게 확인 */
  dirty?: boolean
  /** dirty 시 사용자에게 보일 확인 메시지 */
  dirtyConfirmMessage?: string
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
  dirty = false,
  dirtyConfirmMessage = '작성한 내용을 버릴까요?',
}: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const [closing, setClosing] = useState(false)

  // 최신 콜백/옵션을 ref로 참조 — effect를 mount 1회로 고정하기 위함.
  // ★ onClose가 inline 함수면 부모 재렌더마다 identity가 바뀌는데,
  //   effect가 onClose에 의존하면 재실행 cleanup의 포커스 복원이 input을 blur시켜
  //   모바일에서 키보드가 떴다 숨겨졌다 반복하는 루프가 생긴다
  //   (키보드 오픈 → viewport 리사이즈 → 부모 재렌더 → effect 재실행 → blur → ...).
  const onCloseRef = useRef(onClose)
  const closeOnEscapeRef = useRef(closeOnEscape)
  const dirtyRef = useRef(dirty)
  const dirtyMsgRef = useRef(dirtyConfirmMessage)
  useLayoutEffect(() => {
    onCloseRef.current = onClose
    closeOnEscapeRef.current = closeOnEscape
    dirtyRef.current = dirty
    dirtyMsgRef.current = dirtyConfirmMessage
  })

  // dirty 가드 + 퇴장 애니메이션 트리거 — 외부에서 onClose 부르기 전에 확인
  // ※ window.confirm은 잠시 유지 (Modal 안에서 또 Modal 띄우면 z-index 충돌·포커스 트랩 충돌).
  //   추후 토스트 undo 패턴으로 교체 가능.
  function attemptClose() {
    if (dirtyRef.current) {
      const ok = window.confirm(dirtyMsgRef.current)
      if (!ok) return
    }
    setClosing(true)
    // 퇴장 애니메이션 길이만큼 기다리고 실제 onClose
    window.setTimeout(() => onCloseRef.current(), 140)
  }

  // 포커스 트랩 + Escape + 포커스 복원 — mount/unmount 시에만 실행
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
      if (e.key === 'Escape' && closeOnEscapeRef.current) {
        e.stopPropagation()
        attemptClose()
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // 콜백은 ref로 참조 — mount 1회 고정

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      className={cn(
        'fixed inset-0 flex justify-center bg-black/40',
        sheetOnMobile ? 'items-end sm:items-center' : 'items-center p-4',
        closing ? 'modal-overlay-exit' : 'modal-overlay-enter',
        overlayClassName,
      )}
      style={{ zIndex: 'var(--z-modal)' as unknown as number }}
      onClick={closeOnBackdrop ? attemptClose : undefined}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'bg-white dark:bg-gray-900 rounded-2xl shadow-xl',
          // 모바일 시트는 별도 애니메이션(slide-up), 데스크탑 중앙은 fade+scale
          sheetOnMobile
            ? closing ? 'modal-sheet-exit sm:modal-panel-exit' : 'modal-sheet-enter sm:modal-panel-enter'
            : closing ? 'modal-panel-exit' : 'modal-panel-enter',
          panelClassName,
        )}
      >
        {children}
      </div>
    </div>,
    document.body,
  )
}
