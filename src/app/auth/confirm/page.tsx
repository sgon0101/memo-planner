'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

// hash fragment(#access_token=...) 방식의 OAuth 토큰을 처리하는 클라이언트 페이지
export default function AuthConfirmPage() {
  const router = useRouter()

  useEffect(() => {
    const supabase = createClient()

    // Supabase가 hash fragment를 자동으로 처리해 세션을 설정함
    supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session) {
        router.replace('/memo')
      } else if (event === 'SIGNED_OUT' || !session) {
        // 짧게 대기 후 세션 재확인
        setTimeout(async () => {
          const { data: { session: s } } = await supabase.auth.getSession()
          if (s) {
            router.replace('/memo')
          } else {
            router.replace('/login?error=auth_failed')
          }
        }, 1500)
      }
    })

    // 페이지 로드 시 이미 세션이 있으면 바로 이동
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) router.replace('/memo')
    })
  }, [router])

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
      <div className="flex flex-col items-center gap-3 text-gray-500">
        <div className="w-8 h-8 border-2 border-violet-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm">로그인 처리 중...</p>
      </div>
    </div>
  )
}
