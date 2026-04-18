'use client'

import { useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Suspense } from 'react'

function ConfirmInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const done = useRef(false)

  useEffect(() => {
    if (done.current) return
    done.current = true

    const supabase = createClient()
    const code = searchParams.get('code')

    async function handle() {
      // 1) code가 있으면 PKCE exchange 시도
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (!error) {
          router.replace('/memo')
          return
        }
      }

      // 2) hash fragment 방식 (implicit flow) — Supabase가 자동 처리
      // onAuthStateChange가 SIGNED_IN 이벤트를 발생시킬 때까지 대기
      const { data: { session } } = await supabase.auth.getSession()
      if (session) {
        router.replace('/memo')
        return
      }

      // 3) 이벤트 대기 (최대 5초)
      const timeout = setTimeout(() => {
        router.replace('/login?error=timeout')
      }, 5000)

      const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_IN' && session) {
          clearTimeout(timeout)
          subscription.unsubscribe()
          router.replace('/memo')
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
