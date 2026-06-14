'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export type ToastType = 'success' | 'error' | 'warning' | 'info'

export interface ToastAction {
  /** 버튼 라벨 (예: "되돌리기") */
  label: string
  /** 클릭 핸들러. 호출 후 토스트는 자동으로 닫힘 */
  onClick: () => void
}

interface ToastProps {
  id: string
  type: ToastType
  message: string
  duration?: number
  action?: ToastAction
  onClose: (id: string) => void
}

const CONFIG: Record<ToastType, { icon: React.ReactNode; classes: string; role: 'status' | 'alert' }> = {
  success: {
    icon: <CheckCircle2 size={16} className="text-emerald-500 flex-shrink-0" />,
    classes: 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200',
    role: 'status',
  },
  error: {
    icon: <XCircle size={16} className="text-red-500 flex-shrink-0" />,
    classes: 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200',
    role: 'alert',
  },
  warning: {
    icon: <AlertTriangle size={16} className="text-amber-500 flex-shrink-0" />,
    classes: 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200',
    role: 'alert',
  },
  info: {
    icon: <Info size={16} className="text-blue-500 flex-shrink-0" />,
    classes: 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200',
    role: 'status',
  },
}

function Toast({ id, type, message, duration, action, onClose }: ToastProps) {
  const [visible, setVisible] = useState(false)
  const { icon, classes, role } = CONFIG[type]
  // action이 있으면 사용자가 누를 시간이 더 필요 — 기본 6.5s, 없으면 3.5s
  const finalDuration = duration ?? (action ? 6500 : 3500)

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true))
    const t = setTimeout(() => { setVisible(false); setTimeout(() => onClose(id), 200) }, finalDuration)
    return () => clearTimeout(t)
  }, [finalDuration, id, onClose])

  return (
    <div
      role={role}
      aria-live={role === 'alert' ? 'assertive' : 'polite'}
      aria-atomic="true"
      className={cn(
        'flex items-center gap-2.5 px-4 py-3 rounded-xl border shadow-md text-sm font-medium min-w-[220px] max-w-xs',
        'transition-all duration-200',
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2',
        classes,
      )}
    >
      {icon}
      <span className="flex-1 leading-snug">{message}</span>
      {action && (
        <button
          onClick={() => {
            action.onClick()
            setVisible(false)
            setTimeout(() => onClose(id), 200)
          }}
          className={cn(
            'flex-shrink-0 px-2 py-0.5 rounded-md text-xs font-semibold underline-offset-2 hover:underline',
            'cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2',
          )}
        >
          {action.label}
        </button>
      )}
      <button
        onClick={() => { setVisible(false); setTimeout(() => onClose(id), 200) }}
        className="opacity-60 hover:opacity-100 transition-opacity cursor-pointer ml-1"
        aria-label="닫기"
      >
        <X size={13} />
      </button>
    </div>
  )
}

export interface ToastItem {
  id: string
  type: ToastType
  message: string
  duration?: number
  action?: ToastAction
}

interface ToastContainerProps {
  toasts: ToastItem[]
  onClose: (id: string) => void
}

export function ToastContainer({ toasts, onClose }: ToastContainerProps) {
  if (toasts.length === 0) return null
  return (
    <div
      role="region"
      aria-label="알림"
      className="fixed bottom-20 md:bottom-6 right-4 flex flex-col gap-2 items-end pointer-events-none"
      style={{ zIndex: 'var(--z-toast)' as unknown as number }}
    >
      {toasts.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <Toast {...t} onClose={onClose} />
        </div>
      ))}
    </div>
  )
}

let toastCallback: ((item: ToastItem) => void) | null = null

export function registerToastCallback(fn: (item: ToastItem) => void) {
  toastCallback = fn
}

/**
 * 두 가지 호출 방식 모두 지원:
 * - toast('success', '저장됨')
 * - toast.success('저장됨')                ← 한 줄로 짧게
 * - toast.success('이동됨', { action: { label: '되돌리기', onClick: undo } })
 */
type ToastOpts = { duration?: number; action?: ToastAction }

function emitToast(type: ToastType, message: string, optsOrDuration?: ToastOpts | number) {
  const opts: ToastOpts =
    typeof optsOrDuration === 'number' ? { duration: optsOrDuration }
    : optsOrDuration ?? {}
  toastCallback?.({
    id: `${Date.now()}-${Math.random()}`,
    type,
    message,
    duration: opts.duration,
    action: opts.action,
  })
}

interface ToastFn {
  (type: ToastType, message: string, optsOrDuration?: ToastOpts | number): void
  success: (message: string, opts?: ToastOpts) => void
  error:   (message: string, opts?: ToastOpts) => void
  warning: (message: string, opts?: ToastOpts) => void
  info:    (message: string, opts?: ToastOpts) => void
}

export const toast: ToastFn = Object.assign(
  (type: ToastType, message: string, optsOrDuration?: ToastOpts | number) => emitToast(type, message, optsOrDuration),
  {
    success: (message: string, opts?: ToastOpts) => emitToast('success', message, opts),
    error:   (message: string, opts?: ToastOpts) => emitToast('error',   message, opts),
    warning: (message: string, opts?: ToastOpts) => emitToast('warning', message, opts),
    info:    (message: string, opts?: ToastOpts) => emitToast('info',    message, opts),
  },
)
