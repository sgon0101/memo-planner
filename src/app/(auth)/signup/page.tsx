'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import {
  FormAlert, GoogleIcon, MIN_PASSWORD_LENGTH, PasswordChecklist, PasswordInput,
  authInputClass, authLabelClass, authPrimaryButtonClass,
} from '@/components/auth/AuthControls'

export default function SignupPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const confirmRef = useRef<HTMLInputElement>(null)

  const lengthOk = password.length >= MIN_PASSWORD_LENGTH
  const matchOk = confirm.length > 0 && password === confirm

  async function handleGoogleSignup() {
    setGoogleLoading(true)
    setError('')
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        queryParams: { access_type: 'offline', prompt: 'consent' },
      },
    })
    if (error) {
      setError('Google 연동 중 오류가 발생했습니다.')
      setGoogleLoading(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (!lengthOk) { setError(`비밀번호는 ${MIN_PASSWORD_LENGTH}자 이상이어야 합니다.`); passwordRef.current?.focus(); return }
    if (!matchOk) { setError('비밀번호가 일치하지 않습니다.'); confirmRef.current?.focus(); return }

    setLoading(true)
    const supabase = createClient()
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    })

    if (error) {
      if (/already registered|already exists/i.test(error.message)) {
        setError('이미 가입된 이메일이에요. 로그인하거나 비밀번호를 재설정해주세요.')
        emailRef.current?.focus()
      } else if (/password/i.test(error.message)) {
        setError('사용할 수 없는 비밀번호예요. 다른 비밀번호를 입력해주세요.')
        passwordRef.current?.focus()
      } else {
        setError(error.message)
      }
      setLoading(false)
      return
    }
    setSuccess(true)
  }

  if (success) {
    return (
      <div className="w-full max-w-sm">
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-800 p-8 text-center">
          <div className="w-12 h-12 bg-violet-100 dark:bg-violet-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-violet-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">이메일을 확인하세요</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
            <span className="font-medium text-gray-700 dark:text-gray-300">{email}</span>으로<br />
            인증 메일을 발송했습니다.
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
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Weave</h1>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">새 계정을 만드세요</p>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-800 p-8 space-y-5">
        {/* 구글 회원가입 버튼 */}
        <button
          type="button"
          onClick={handleGoogleSignup}
          disabled={googleLoading || loading}
          className="w-full flex items-center justify-center gap-2.5 py-2.5 px-4 border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-sm font-medium text-gray-700 dark:text-gray-300 disabled:opacity-50"
        >
          <GoogleIcon />
          {googleLoading ? '연결 중...' : 'Google로 계속하기'}
        </button>

        {/* 구분선 */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
          <span className="text-xs text-gray-400">또는 이메일로 가입</span>
          <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="signup-email" className={authLabelClass}>이메일</label>
            <input
              ref={emailRef}
              id="signup-email"
              type="email"
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="example@email.com"
              aria-invalid={!!error && /이메일/.test(error)}
              aria-describedby={error ? 'signup-error' : undefined}
              className={authInputClass}
            />
          </div>

          <div>
            <label htmlFor="signup-password" className={authLabelClass}>비밀번호</label>
            <PasswordInput
              ref={passwordRef}
              id="signup-password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder={`${MIN_PASSWORD_LENGTH}자 이상`}
              aria-invalid={!!error && !lengthOk}
              aria-describedby={['signup-pw-rules', error ? 'signup-error' : ''].filter(Boolean).join(' ')}
            />
          </div>

          <div>
            <label htmlFor="signup-confirm" className={authLabelClass}>비밀번호 확인</label>
            <PasswordInput
              ref={confirmRef}
              id="signup-confirm"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              placeholder="비밀번호 재입력"
              aria-invalid={!!error && lengthOk && !matchOk}
              aria-describedby={['signup-pw-rules', error ? 'signup-error' : ''].filter(Boolean).join(' ')}
            />
            <PasswordChecklist
              id="signup-pw-rules"
              items={[
                { label: `${MIN_PASSWORD_LENGTH}자 이상`, ok: lengthOk },
                { label: '두 비밀번호 일치', ok: matchOk },
              ]}
            />
          </div>

          <FormAlert id="signup-error" message={error} />

          <button type="submit" disabled={loading || googleLoading} className={authPrimaryButtonClass}>
            {loading ? '가입 중...' : '회원가입'}
          </button>
        </form>

        <p className="text-center text-sm text-gray-500 dark:text-gray-400">
          이미 계정이 있으신가요?{' '}
          <Link href="/login" className="text-violet-600 hover:text-violet-700 font-medium">로그인</Link>
        </p>
      </div>
    </div>
  )
}
