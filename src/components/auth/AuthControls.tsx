'use client'

/**
 * 인증 화면 공용 컨트롤 (2026-10-11 UX 1차 묶음)
 *
 * - label ↔ input을 htmlFor/id로 명시 연결 (스크린리더·라벨 클릭 포커스)
 * - 비밀번호 표시/숨기기 토글 (44px 터치 영역)
 * - 오류는 role="alert"로 즉시 낭독, 입력에는 aria-invalid/aria-describedby
 */

import { forwardRef, useState } from 'react'
import { Eye, EyeOff, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Supabase Auth 최소 길이와 맞춘 값 — 대시보드 정책을 바꾸면 여기도 함께 수정 */
export const MIN_PASSWORD_LENGTH = 6

export const authInputClass =
  'w-full px-3.5 py-2.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 ' +
  'text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-violet-500 ' +
  'focus:border-transparent text-sm aria-[invalid=true]:border-red-400 dark:aria-[invalid=true]:border-red-500'

export const authLabelClass = 'block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5'

export const authPrimaryButtonClass =
  'w-full py-2.5 px-4 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed ' +
  'text-white font-medium rounded-lg transition-colors text-sm'

type PasswordInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput({ className, ...props }, ref) {
    const [visible, setVisible] = useState(false)
    return (
      <div className="relative">
        <input
          ref={ref}
          type={visible ? 'text' : 'password'}
          className={cn(authInputClass, 'pr-11', className)}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label="비밀번호 표시"
          aria-pressed={visible}
          aria-controls={props.id}
          className="absolute inset-y-0 right-0 w-11 flex items-center justify-center rounded-r-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-violet-500"
        >
          {visible ? <EyeOff size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
        </button>
      </div>
    )
  },
)

export function FormAlert({ id, message }: { id: string; message: string }) {
  if (!message) return null
  return (
    <p id={id} role="alert" className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 px-3 py-2 rounded-lg">
      {message}
    </p>
  )
}

/** 비밀번호 조건 실시간 체크리스트 — 입력 전부터 조건을 보여준다 */
export function PasswordChecklist({ items, id }: { id?: string; items: { label: string; ok: boolean }[] }) {
  return (
    <ul id={id} className="mt-2 space-y-1" aria-label="비밀번호 조건">
      {items.map((it) => (
        <li
          key={it.label}
          className={cn(
            'flex items-center gap-1.5 text-xs transition-colors',
            it.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400 dark:text-gray-500',
          )}
        >
          <Check size={12} aria-hidden className={it.ok ? 'opacity-100' : 'opacity-40'} />
          {it.label}
          <span className="sr-only">{it.ok ? ' — 충족' : ' — 미충족'}</span>
        </li>
      ))}
    </ul>
  )
}

export function GoogleIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden>
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
    </svg>
  )
}
