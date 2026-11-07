/**
 * 공개 페이지 공용 틀 — 머리글(로고·로그인·시작하기)과 바닥글(처리방침·약관·문의).
 * 서버 컴포넌트, Supabase 호출 없음(정적 렌더). 다크모드는 root layout의 pre-paint 스크립트를 따른다.
 */

import Link from 'next/link'
import { CONTACT_EMAIL, SITE_NAME } from '@/lib/site'

export function WeaveMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 400 400" width={size} height={size} className={className} aria-hidden="true">
      <rect width="400" height="400" rx="88" fill="#7F77DD" />
      <path d="M 88 120 L 152 280 L 200 160 L 248 280 L 312 120" stroke="white" strokeWidth="10" fill="none" strokeLinecap="round" strokeLinejoin="round" opacity="0.5" />
      <circle cx="88" cy="120" r="28" fill="white" />
      <circle cx="152" cy="280" r="28" fill="white" />
      <circle cx="200" cy="160" r="36" fill="white" />
      <circle cx="248" cy="280" r="28" fill="white" />
      <circle cx="312" cy="120" r="28" fill="white" />
    </svg>
  )
}

export default function PublicShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col bg-white text-gray-900 dark:bg-gray-950 dark:text-gray-100">
      <header className="sticky top-0 z-10 border-b border-gray-100 dark:border-gray-900 bg-white/90 dark:bg-gray-950/90 backdrop-blur">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-16 flex items-center gap-3">
          <Link href="/" className="flex items-center gap-2 min-h-11" aria-label={`${SITE_NAME} 홈`}>
            <WeaveMark size={30} />
            <span className="text-lg font-bold tracking-tight">{SITE_NAME}</span>
          </Link>
          <div className="flex-1" />
          <Link href="/login" className="min-h-11 px-3 sm:px-4 inline-flex items-center rounded-lg text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-900">
            로그인
          </Link>
          <Link href="/signup" className="min-h-11 px-4 inline-flex items-center rounded-lg text-sm font-semibold text-white bg-violet-600 hover:bg-violet-700">
            시작하기
          </Link>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-gray-100 dark:border-gray-900">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 flex flex-col sm:flex-row gap-4 sm:items-center text-sm text-gray-500 dark:text-gray-400">
          <div className="flex items-center gap-2">
            <WeaveMark size={20} />
            <span className="font-semibold text-gray-700 dark:text-gray-300">{SITE_NAME}</span>
          </div>
          <nav aria-label="정책 및 문의" className="flex flex-wrap gap-x-5 gap-y-2 sm:ml-auto">
            <Link href="/privacy" className="hover:text-gray-900 dark:hover:text-white">개인정보 처리방침</Link>
            <Link href="/terms" className="hover:text-gray-900 dark:hover:text-white">이용약관</Link>
            <a href={`mailto:${CONTACT_EMAIL}`} className="hover:text-gray-900 dark:hover:text-white">문의 {CONTACT_EMAIL}</a>
          </nav>
        </div>
      </footer>
    </div>
  )
}

/** 처리방침·약관 본문 틀 — 제목·시행일 + 읽기 좋은 폭 */
export function PolicyArticle({ title, effective, children }: { title: string; effective: string; children: React.ReactNode }) {
  return (
    <article className="max-w-3xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
      <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">시행일 {effective}</p>
      <div className="mt-8 space-y-8 text-[15px] leading-7 text-gray-700 dark:text-gray-300 [&_h2]:text-lg [&_h2]:font-bold [&_h2]:text-gray-900 dark:[&_h2]:text-white [&_h2]:mb-3 [&_h3]:font-semibold [&_h3]:text-gray-900 dark:[&_h3]:text-gray-100 [&_h3]:mt-4 [&_h3]:mb-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_ol]:space-y-1 [&_a]:text-violet-700 dark:[&_a]:text-violet-300 [&_a]:underline [&_a]:underline-offset-2">
        {children}
      </div>
    </article>
  )
}
