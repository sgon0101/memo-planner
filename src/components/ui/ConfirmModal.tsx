'use client'

import { useState } from 'react'
import { AlertTriangle, Trash2 } from 'lucide-react'
import Modal from './Modal'
import { cn } from '@/lib/utils'

/**
 * ConfirmModal — `window.confirm` 대체용 공통 확인 다이얼로그
 *
 * 표준 confirm은 다크모드 미대응 + 한국어 톤 불일치 + 모바일에서 OS별로 다르게 뜸.
 * weave 8곳(메모 휴지통/영구삭제, 폴더 삭제, 휴지통 비우기, 전체 복원,
 * 플랜 삭제, 대화 삭제, 계정 삭제 등)을 단일 패턴으로 통합.
 *
 * variant='danger'면 빨강 강조 + 경고 아이콘.
 * onConfirm이 Promise를 반환하면 로딩 상태 자동 처리(이중 클릭 차단).
 */

interface ConfirmModalProps {
  open: boolean
  /** 모달 닫기 — 취소·완료 모두 같은 핸들러 */
  onClose: () => void
  /** 확인 액션. async면 spinner 표시 후 close */
  onConfirm: () => void | Promise<void>
  title: string
  /** 부제목 / 안내문 — 줄바꿈은 `\n`로 */
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  /** 강조 톤. 기본 default(violet) — 위험한 액션은 danger(red) */
  variant?: 'default' | 'danger'
  /** danger일 때 표시될 아이콘. 기본 Trash2 */
  icon?: React.ReactNode
}

export default function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = '확인',
  cancelLabel = '취소',
  variant = 'default',
  icon,
}: ConfirmModalProps) {
  const [busy, setBusy] = useState(false)

  if (!open) return null

  const isDanger = variant === 'danger'
  const Icon = icon ?? (isDanger ? <Trash2 size={18} /> : <AlertTriangle size={18} />)

  async function handleConfirm() {
    if (busy) return
    try {
      setBusy(true)
      await onConfirm()
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      onClose={busy ? () => {} : onClose}
      ariaLabel={title}
      panelClassName="w-[420px] max-w-[92vw]"
      closeOnBackdrop={!busy}
      closeOnEscape={!busy}
    >
      <div className="p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              'w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0',
              isDanger
                ? 'bg-red-100 text-red-600 dark:bg-red-950/40 dark:text-red-400'
                : 'bg-violet-100 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400',
            )}
            aria-hidden="true"
          >
            {Icon}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              {title}
            </h2>
            {description && (
              <p className="mt-1.5 text-sm text-gray-600 dark:text-gray-400 leading-relaxed whitespace-pre-line">
                {description}
              </p>
            )}
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className={cn(
              'px-3.5 py-2 rounded-lg text-sm font-medium',
              'text-gray-700 dark:text-gray-300',
              'hover:bg-gray-100 dark:hover:bg-gray-800',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500',
              'transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer',
            )}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={busy}
            autoFocus
            className={cn(
              'px-3.5 py-2 rounded-lg text-sm font-medium text-white',
              'focus-visible:outline-2 focus-visible:outline-offset-2',
              'transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer',
              isDanger
                ? 'bg-red-600 hover:bg-red-700 focus-visible:outline-red-500'
                : 'bg-violet-600 hover:bg-violet-700 focus-visible:outline-violet-500',
            )}
          >
            {busy ? '처리 중…' : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  )
}

/**
 * useConfirm — 간단한 useState 래퍼 훅.
 * 8곳 사용처가 한결같이 "state 선언 + setOpen(true) + onConfirm + onClose"라서
 * boilerplate 줄이기 위해 제공.
 *
 * 사용 예:
 *   const confirm = useConfirm()
 *   ...
 *   <button onClick={() => confirm.open({
 *     title: '메모를 휴지통으로 옮길까요?',
 *     onConfirm: async () => { await deleteMemo(id) },
 *     variant: 'default',
 *   })}>...</button>
 *   <confirm.Render />
 */
type OpenArgs = Omit<ConfirmModalProps, 'open' | 'onClose'>

export function useConfirm() {
  const [args, setArgs] = useState<OpenArgs | null>(null)
  return {
    open(a: OpenArgs) { setArgs(a) },
    close() { setArgs(null) },
    Render() {
      if (!args) return null
      return (
        <ConfirmModal
          {...args}
          open
          onClose={() => setArgs(null)}
        />
      )
    },
  }
}
