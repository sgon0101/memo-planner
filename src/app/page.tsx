import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import PublicShell, { WeaveMark } from '@/components/public/PublicShell'
import { SITE_DESCRIPTION, SITE_NAME, SITE_TAGLINE, SITE_URL } from '@/lib/site'

/**
 * 첫 화면 (2026-11-07). 로그인 사용자는 /home으로, 비로그인에게는 로고·한 줄 소개·시작하기만 보여준다.
 * 기능·Google 데이터 사용 설명은 /about(Google 브랜드 인증 '앱 홈페이지'로 등록)에 있다.
 */

export const metadata: Metadata = {
  title: `${SITE_NAME} — ${SITE_TAGLINE}`,
  description: SITE_DESCRIPTION,
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    title: SITE_NAME,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    locale: 'ko_KR',
    images: [{ url: '/icon-512.png', width: 512, height: 512, alt: SITE_NAME }],
  },
}



export default async function RootPage() {
  const supabase = await createClient()
  // 로그인 사용자는 proxy가 먼저 /home으로 보낸다. 여기는 예비 판단 — getClaims()는 서명키 검증이라 빠르다.
  const { data } = await supabase.auth.getClaims()
  if (data?.claims?.sub) redirect('/home')

  return (
    <PublicShell hideHeader>
      {/* 소개 — 시작하기 하나만 (로그인 화면에서 Google·이메일 로그인과 가입을 모두 고른다) */}
      <section className="min-h-[calc(100dvh-6rem)] max-w-5xl mx-auto px-4 sm:px-6 py-14 flex flex-col items-center justify-center text-center">
        <WeaveMark size={72} />
        <h1 className="mt-6 text-4xl sm:text-5xl font-bold tracking-tight">{SITE_NAME}</h1>
        <p className="mt-4 text-lg sm:text-xl leading-8 text-gray-600 dark:text-gray-300 break-keep">
          자신의 경험을 모으고 엮어, 더 나은 나를 만드는 메모·플래너
        </p>
        <Link href="/login" className="mt-10 w-full max-w-xs min-h-12 px-6 inline-flex items-center justify-center rounded-xl text-base font-semibold text-white bg-violet-600 hover:bg-violet-700">
          시작하기
        </Link>
        <Link href="/about" className="mt-4 min-h-11 inline-flex items-center text-sm text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white">
          {SITE_NAME} 소개 보기
        </Link>
      </section>
    </PublicShell>
  )
}
