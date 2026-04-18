'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export type ToastType = 'success' | 'error' | 'warning' | 'info'

interface ToastProps {
  id: string
  type: ToastType
  message: string
  duration?: number
  onClose: (id: string) => void
}

const CONFIG: Record<ToastType, { icon: React.ReactNode; classes: string }> = {
  success: {
    icon: <CheckCircle2 size={16} className="text-emerald-500 flex-shrink-0" />,
    classes: 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200',
  },
  error: {
    icon: <XCircle size={16} className="text-red-500 flex-shrink-0" />,
    classes: 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800 text-red-800 dark:text-red-200',
  },
  warning: {
    icon: <AlertTriangle size={16} className="text-amber-500 flex-shrink-0" />,
    classes: 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200',
  },
  info: {
    icon: <Info size={16} className="text-blue-500 flex-shrink-0" />,
    classes: 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200',
  },
}

function Toast({ id, type, message, duration = 3500, onClose }: ToastProps) {
  const [visible, setVisible] = useState(false)
  const { icon, classes } = CONFIG[type]

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true))
    const t = setTimeout(() => { setVisible(false); setTimeout(() => onClose(id), 200) }, duration)
    return () => clearTimeout(t)
  }, [duration, id, onClose])

  return (
    <div
      className={cn(
        'flex items-center gap-2.5 px-4 py-3 rounded-xl border shadow-md text-sm font-medium min-w-[220px] max-w-xs',
        'transition-all duration-200',
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2',
        classes,
      )}
    >
      {icon}
      <span className="flex-1 leading-snug">{message}</span>
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
}

interface ToastContainerProps {
  toasts: ToastItem[]
  onClose: (id: string) => void
}

export function ToastContainer({ toasts, onClose }: ToastContainerProps) {
  if (toasts.length === 0) return null
  return (
    <div className="fixed bottom-20 md:bottom-6 right-4 z-50 flex flex-col gap-2 items-end">
      {toasts.map((t) => (
        <Toast key={t.id} {...t} onClose={onClose} />
      ))}
    </div>
  )
}

let toastCallback: ((item: ToastItem) => void) | null = null

export function registerToastCallback(fn: (item: ToastItem) => void) {
  toastCallback = fn
}

export function toast(type: ToastType, message: string, duration?: number) {
  toastCallback?.({ id: `${Date.now()}-${Math.random()}`, type, message, duration })
}
