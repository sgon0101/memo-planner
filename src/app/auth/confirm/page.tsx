'use client'

import { useEffect, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

function ConfirmInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const done = useRef(false)

  useEffect(() => {
    if (done.current) return
    done.current = true

    const supabase = createClient()
    const code = searchParams.get('code')
    // callback에서 검증된 내부 경로만 넘어오지만 한 번 더 방어
    const nextRaw = searchParams.get('next')
    const next = nextRaw && nextRaw.startsWith('/') && !nextRaw.startsWith('//') ? nextRaw : null
    const isRecovery = next === '/reset-password'
    const successPath = next ?? '/memo'

    async function handle() {
      // 1) code PKCE exchange
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (!error) {
          router.replace(successPath)
          return
        }
        // 재설정 링크 만료/다른 브라우저에서 열림(PKCE verifier 없음) → 재요청 화면으로
        if (isRecovery) {
          router.replace('/forgot-password?error=link')
          return
        }
        // 실제 에러 메시지를 URL에 담아 전달
        const msg = encodeURIComponent(error.message)
        router.replace(`/login?error=exchange&msg=${msg}`)
        return
      }

      // 2) hash fragment 방식 — 기존 세션 확인
      const { data: { session } } = await supabase.auth.getSession()
      if (session) {
        router.replace(successPath)
        return
      }

      // 3) onAuthStateChange 대기 (최대 5초)
      const timeout = setTimeout(() => {
        router.replace(isRecovery ? '/forgot-password?error=link' : '/login?error=timeout')
      }, 5000)

      const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'PASSWORD_RECOVERY' && session) {
          clearTimeout(timeout)
          subscription.unsubscribe()
          router.replace('/reset-password')
          return
        }
        if (event === 'SIGNED_IN' && session) {
          clearTimeout(timeout)
          subscription.unsubscribe()
          router.replace(successPath)
        }
      })
    }

    handle()
  }, [])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
      <div className="flex flex-col items-center gap-3 text-gray-500">
        <div className="w-8 h-8 border-2 border-violet-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm">로그인 처리 중...</p>
      </div>
    </div>
  )
}

export default function AuthConfirmPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-violet-600 border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <ConfirmInner />
    </Suspense>
  )
}
