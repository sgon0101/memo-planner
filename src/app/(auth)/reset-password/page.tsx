'use client'

/**
 * 새 비밀번호 설정 — 재설정 메일 링크로 들어온 recovery 세션에서만 사용.
 * 세션이 없으면 proxy가 /login으로 보내므로, 여기선 세션 존재를 전제로 한다.
 * (만료 대비로 updateUser 실패 시 /forgot-password 재요청 링크를 안내)
 */

import { useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  FormAlert, MIN_PASSWORD_LENGTH, PasswordChecklist, PasswordInput,
  authLabelClass, authPrimaryButtonClass,
} from '@/components/auth/AuthControls'

export default function ResetPasswordPage() {
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [expired, setExpired] = useState(false)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const passwordRef = useRef<HTMLInputElement>(null)
  const confirmRef = useRef<HTMLInputElement>(null)

  const lengthOk = password.length >= MIN_PASSWORD_LENGTH
  const matchOk = confirm.length > 0 && password === confirm

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setExpired(false)
    if (!lengthOk) { setError(`비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 해요.`); passwordRef.current?.focus(); return }
    if (!matchOk) { setError('비밀번호가 일치하지 않아요.'); confirmRef.current?.focus(); return }

    setLoading(true)
    const supabase = createClient()
    const { error } = await supabase.auth.updateUser({ password })
    setLoading(false)

    if (error) {
      if (/same|different from the old/i.test(error.message)) {
        setError('이전과 다른 비밀번호를 입력해주세요.')
        passwordRef.current?.focus()
      } else if (/session|jwt|expired|not authenticated/i.test(error.message)) {
        setExpired(true)
        setError('재설정 링크가 만료되었어요.')
      } else {
        setError('비밀번호를 변경하지 못했어요. 잠시 후 다시 시도해주세요.')
      }
      return
    }

    setDone(true)
    setTimeout(() => { router.replace('/memo'); router.refresh() }, 1200)
  }

  if (done) {
    return (
      <div className="w-full max-w-sm">
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-800 p-8 text-center" role="status">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">비밀번호를 변경했어요</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">잠시 후 메모 화면으로 이동합니다.</p>
        </div>
      </div>
    )
  }

  const describedBy = ['reset-pw-rules', error ? 'reset-error' : ''].filter(Boolean).join(' ')

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">새 비밀번호 설정</h1>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">앞으로 사용할 비밀번호를 입력하세요</p>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-800 p-8 space-y-5">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="reset-password" className={authLabelClass}>새 비밀번호</label>
            <PasswordInput
              ref={passwordRef}
              id="reset-password"
              autoComplete="new-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              aria-invalid={!!error && !lengthOk}
              aria-describedby={describedBy}
            />
          </div>

          <div>
            <label htmlFor="reset-confirm" className={authLabelClass}>새 비밀번호 확인</label>
            <PasswordInput
              ref={confirmRef}
              id="reset-confirm"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              aria-invalid={!!error && lengthOk && !matchOk}
              aria-describedby={describedBy}
            />
            <PasswordChecklist
              id="reset-pw-rules"
              items={[
                { label: `${MIN_PASSWORD_LENGTH}자 이상`, ok: lengthOk },
                { label: '두 비밀번호 일치', ok: matchOk },
              ]}
            />
          </div>

          <FormAlert id="reset-error" message={error} />
          {expired && (
            <Link href="/forgot-password" className="block text-center text-sm text-violet-600 hover:text-violet-700 font-medium">
              새 재설정 링크 받기
            </Link>
          )}

          <button type="submit" disabled={loading} className={authPrimaryButtonClass}>
            {loading ? '변경 중...' : '비밀번호 변경'}
          </button>
        </form>
      </div>
    </div>
  )
}
