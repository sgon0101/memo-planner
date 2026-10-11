'use client'

/**
 * 비밀번호 재설정 요청 — 이메일로 재설정 링크 발송.
 * 링크 → /auth/callback?next=/reset-password → /auth/confirm(코드 교환) → /reset-password
 *
 * 보안: 가입 여부를 노출하지 않도록 성공/미가입 모두 같은 안내를 보여준다.
 */

import { Suspense, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ArrowLeft, MailCheck } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { FormAlert, authInputClass, authLabelClass, authPrimaryButtonClass } from '@/components/auth/AuthControls'

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={<div className="w-full max-w-sm" />}>
      <ForgotPasswordForm />
    </Suspense>
  )
}

function ForgotPasswordForm() {
  const searchParams = useSearchParams()
  const linkError = searchParams.get('error') === 'link'
  const [email, setEmail] = useState('')
  const [error, setError] = useState(
    linkError ? '재설정 링크가 만료되었거나 이미 사용되었어요. 새 링크를 받아주세요.' : '',
  )
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const emailRef = useRef<HTMLInputElement>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const supabase = createClient()
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    })
    setLoading(false)
    if (error) {
      // 429(요청 과다)만 구분해서 안내 — 그 외는 가입 여부 노출 방지 위해 일반 문구
      const tooMany = error.status === 429 || /rate limit/i.test(error.message)
      setError(tooMany ? '요청이 너무 잦아요. 잠시 후 다시 시도해주세요.' : '메일을 보내지 못했어요. 잠시 후 다시 시도해주세요.')
      emailRef.current?.focus()
      return
    }
    setSent(true)
  }

  if (sent) {
    return (
      <div className="w-full max-w-sm">
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-800 p-8 text-center" role="status">
          <div className="w-12 h-12 bg-violet-100 dark:bg-violet-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
            <MailCheck className="w-6 h-6 text-violet-600" aria-hidden />
          </div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">메일함을 확인하세요</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
            <span className="font-medium text-gray-700 dark:text-gray-300">{email}</span>(으)로 가입된 계정이 있다면<br />
            비밀번호 재설정 링크를 보냈어요.
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-6">
            링크는 이 브라우저에서 열어주세요. 메일이 없다면 스팸함도 확인해주세요.
          </p>
          <Link href="/login" className="text-sm text-violet-600 hover:text-violet-700 font-medium">
            로그인으로 돌아가기
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">비밀번호 재설정</h1>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">가입한 이메일로 재설정 링크를 보내드려요</p>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-800 p-8 space-y-5">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="forgot-email" className={authLabelClass}>이메일</label>
            <input
              ref={emailRef}
              id="forgot-email"
              type="email"
              autoComplete="email"
              inputMode="email"
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="example@email.com"
              aria-invalid={!!error}
              aria-describedby={error ? 'forgot-error' : undefined}
              className={authInputClass}
            />
          </div>

          <FormAlert id="forgot-error" message={error} />

          <button type="submit" disabled={loading} className={authPrimaryButtonClass}>
            {loading ? '보내는 중...' : '재설정 링크 보내기'}
          </button>
        </form>

        <Link
          href="/login"
          className="flex items-center justify-center gap-1.5 min-h-11 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        >
          <ArrowLeft size={14} aria-hidden />
          로그인으로 돌아가기
        </Link>
      </div>
    </div>
  )
}
