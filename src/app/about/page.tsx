import type { Metadata } from 'next'
import Link from 'next/link'
import PublicShell from '@/components/public/PublicShell'
import { SITE_DESCRIPTION, SITE_NAME } from '@/lib/site'

/**
 * 서비스 소개 (2026-11-07). 첫 화면(/)을 깔끔하게 두고, 앱 기능·Google 데이터 사용 설명은 여기로 옮겼다.
 * Google OAuth 브랜드 인증의 '앱 홈페이지' 주소로 이 페이지(/about)를 등록한다 — 로그인 없이 열리고,
 * 앱 이름·목적·Google 데이터 사용·개인정보 처리방침 링크를 담는다.
 */

export const metadata: Metadata = {
  title: `${SITE_NAME} 소개`,
  description: SITE_DESCRIPTION,
  alternates: { canonical: '/about' },
}

const FEATURES = [
  {
    title: '빠른 메모와 위키 연결',
    body: '떠오른 생각을 바로 적고, [[위키]]와 #태그로 엮어 두면 같은 주제의 메모가 한곳에 모여요.',
    icon: (
      <path d="M8 4h9l3 3v13H8zM8 9h12M11 13h6M11 16h4" />
    ),
  },
  {
    title: '그래프 뷰',
    body: '메모와 위키가 이어진 모습을 그래프로 보며, 생각이 어디로 뻗어 가는지 한눈에 확인해요.',
    icon: (
      <>
        <circle cx="6" cy="7" r="2.2" /><circle cx="18" cy="6" r="2.2" /><circle cx="12" cy="17" r="2.6" />
        <path d="M7.8 8.2l2.9 6.6M16.4 7.5l-3.3 7.2M8.2 7l7.6-.8" />
      </>
    ),
  },
  {
    title: 'PDF·이미지 → 요약 노트',
    body: '강의 자료나 캡처를 올리면 핵심을 정리한 노트로 만들고, 기존 위키와 연결해 드려요.',
    icon: (
      <path d="M7 3h7l4 4v14H7zM14 3v4h4M10 12h5M10 15h5M10 18h3" />
    ),
  },
  {
    title: '플래너와 하루 마감',
    body: '할 일을 인박스에 모았다가 캘린더로 끌어 일정을 정하고, 하루를 마감하며 돌아봐요.',
    icon: (
      <>
        <rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M9 3v4M15 3v4M9 14l2 2 4-4" />
      </>
    ),
  },
] as const

export default function AboutPage() {
  return (
    <PublicShell>
      <section className="max-w-5xl mx-auto px-4 sm:px-6 pt-14 pb-10 text-center">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">{SITE_NAME} 소개</h1>
        <p className="mt-4 text-[17px] leading-8 text-gray-600 dark:text-gray-300">
          {SITE_NAME}는 자신의 경험을 모으고 엮어, 더 나은 나를 만드는 개인 메모·플래너 앱이에요.
        </p>
      </section>

      {/* 핵심 기능 */}
      <section aria-labelledby="features" className="bg-gray-50 dark:bg-gray-900/50 border-y border-gray-100 dark:border-gray-900">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-14">
          <h2 id="features" className="text-2xl font-bold tracking-tight text-center">Weave로 할 수 있는 일</h2>
          <ul className="mt-8 grid sm:grid-cols-2 gap-4">
            {FEATURES.map((f) => (
              <li key={f.title} className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 p-5">
                <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="#7C3AED" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  {f.icon}
                </svg>
                <h3 className="mt-3 text-lg font-semibold">{f.title}</h3>
                <p className="mt-1.5 text-[15px] leading-7 text-gray-600 dark:text-gray-400">{f.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Google 사용자 데이터 사용 — 브랜드 인증 심사 항목 */}
      <section aria-labelledby="google-data" className="max-w-3xl mx-auto px-4 sm:px-6 py-14">
        <h2 id="google-data" className="text-2xl font-bold tracking-tight">Google 계정 데이터를 이렇게 사용해요</h2>
        <p className="mt-3 text-[15px] leading-7 text-gray-600 dark:text-gray-400">
          Weave는 아래 목적에만 Google 데이터를 사용하고, 판매하거나 광고에 쓰지 않아요. 연결은 언제든 설정에서 해제할 수 있어요.
        </p>
        <dl className="mt-6 space-y-4">
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-4">
            <dt className="font-semibold">Google 로그인</dt>
            <dd className="mt-1 text-[15px] leading-7 text-gray-600 dark:text-gray-400">이름, 이메일 주소, 프로필 사진으로 계정을 만들고 로그인해요.</dd>
          </div>
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-4">
            <dt className="font-semibold">Google Drive 백업 <span className="text-sm font-normal text-gray-500">(선택)</span></dt>
            <dd className="mt-1 text-[15px] leading-7 text-gray-600 dark:text-gray-400">직접 연결한 경우에만, 내 Drive에 Weave 백업 파일을 만들고 불러와요. Weave가 만든 파일 외에는 보지 않아요.</dd>
          </div>
          <div className="rounded-xl border border-gray-200 dark:border-gray-800 p-4">
            <dt className="font-semibold">Google Calendar 동기화 <span className="text-sm font-normal text-gray-500">(선택)</span></dt>
            <dd className="mt-1 text-[15px] leading-7 text-gray-600 dark:text-gray-400">직접 연결하고 동기화를 누른 경우에만, Weave 플랜을 내 캘린더에 일정으로 추가해요. 기존 일정을 읽지 않아요.</dd>
          </div>
        </dl>
        <p className="mt-6 text-sm text-gray-500 dark:text-gray-400">
          자세한 내용은 <Link href="/privacy" className="text-violet-700 dark:text-violet-300 underline underline-offset-2">개인정보 처리방침</Link>에서 확인할 수 있어요.
        </p>
      </section>

      <section className="max-w-3xl mx-auto px-4 sm:px-6 pb-16 text-center">
        <Link href="/login" className="min-h-12 px-8 inline-flex items-center justify-center rounded-xl text-base font-semibold text-white bg-violet-600 hover:bg-violet-700">
          시작하기
        </Link>
      </section>
    </PublicShell>
  )
}
