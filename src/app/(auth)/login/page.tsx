'use client'

import { useRef, useState, Suspense } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  FormAlert, GoogleIcon, PasswordInput,
  authInputClass, authLabelClass, authPrimaryButtonClass,
} from '@/components/auth/AuthControls'

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="w-full max-w-sm" />}>
      <LoginForm />
    </Suspense>
  )
}

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const urlError = searchParams.get('error')
  const urlMsg = searchParams.get('msg')
  const urlErrorCode = searchParams.get('error_code')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(true)
  const [error, setError] = useState(() => {
    if (!urlError) return ''
    // 메일 링크(가입 인증 등)가 만료됐거나 이미 사용됨 — Google 로그인과 무관
    if (urlErrorCode === 'otp_expired') {
      return '인증 링크가 만료되었거나 이미 사용됐어요. 이미 인증하셨다면 바로 로그인해 주세요.'
    }
    // 코드 교환 실패 — 이메일 링크와 Google 로그인 모두 이 경로를 지난다
    if (urlMsg) return `로그인을 마치지 못했어요: ${decodeURIComponent(urlMsg)}`
    if (urlError === 'timeout') return '로그인 처리 시간이 초과됐습니다. 다시 시도해주세요.'
    // Google 동의 화면에서 취소한 경우
    if (urlError === 'access_denied') return '로그인이 취소됐어요. 다시 시도해주세요.'
    return '로그인에 실패했습니다. 다시 시도해주세요.'
  })
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      if (error.message === 'Invalid login credentials') {
        setError('이메일 또는 비밀번호가 올바르지 않습니다.')
        passwordRef.current?.select()
        passwordRef.current?.focus()
      } else if (/email not confirmed/i.test(error.message)) {
        setError('이메일 인증이 아직 완료되지 않았어요. 메일함의 인증 링크를 눌러주세요.')
        emailRef.current?.focus()
      } else {
        setError(error.message)
      }
      setLoading(false)
      return
    }

    // 로그인 상태 유지 설정 저장
    if (!rememberMe) {
      sessionStorage.setItem('no-persist', '1')
    } else {
      sessionStorage.removeItem('no-persist')
    }

    router.push('/memo')
    router.refresh()
  }

  async function handleGoogleLogin() {
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
      setError('Google 로그인 중 오류가 발생했습니다.')
      setGoogleLoading(false)
    }
  }

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 text-center">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Weave</h1>
        <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">로그인하여 시작하세요</p>
      </div>

      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-800 p-8 space-y-5">
        {/* 구글 로그인 버튼 */}
        <button
          type="button"
          onClick={handleGoogleLogin}
          disabled={googleLoading || loading}
          className="w-full flex items-center justify-center gap-2.5 py-2.5 px-4 border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-sm font-medium text-gray-700 dark:text-gray-300 disabled:opacity-50"
        >
          <GoogleIcon />
          {googleLoading ? '연결 중...' : 'Google로 로그인'}
        </button>

        {/* 구분선 */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
          <span className="text-xs text-gray-400">또는</span>
          <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="login-email" className={authLabelClass}>이메일</label>
            <input
              ref={emailRef}
              id="login-email"
              type="email"
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="example@email.com"
              aria-invalid={!!error}
              aria-describedby={error ? 'login-error' : undefined}
              className={authInputClass}
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label htmlFor="login-password" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                비밀번호
              </label>
              <Link
                href="/forgot-password"
                className="text-xs text-gray-500 hover:text-violet-600 dark:text-gray-400 dark:hover:text-violet-400 py-1 -my-1"
              >
                비밀번호를 잊으셨나요?
              </Link>
            </div>
            <PasswordInput
              ref={passwordRef}
              id="login-password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="비밀번호 입력"
              aria-invalid={!!error}
              aria-describedby={error ? 'login-error' : undefined}
            />
          </div>

          {/* 로그인 상태 유지 */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              className="w-4 h-4 rounded accent-violet-600"
            />
            <span className="text-sm text-gray-600 dark:text-gray-400">로그인 상태 유지</span>
          </label>

          <FormAlert id="login-error" message={error} />

          <button type="submit" disabled={loading || googleLoading} className={authPrimaryButtonClass}>
            {loading ? '로그인 중...' : '로그인'}
          </button>
        </form>

        <p className="text-center text-sm text-gray-500 dark:text-gray-400">
          계정이 없으신가요?{' '}
          <Link href="/signup" className="text-violet-600 hover:text-violet-700 font-medium">
            회원가입
          </Link>
        </p>
      </div>
    </div>
  )
}
