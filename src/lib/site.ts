/**
 * 공개 페이지(랜딩·개인정보 처리방침·이용약관) 공용 상수 (2026-11-07).
 * 도메인(useweave.app)을 연결하면 NEXT_PUBLIC_SITE_URL만 바꾸면 된다 — 없으면 Vercel 운영 도메인.
 */

export const SITE_NAME = 'Weave'
export const SITE_TAGLINE = '경험을 모으고 엮어 더 나은 나로'
export const SITE_DESCRIPTION =
  '메모를 [[위키]]로 엮고, 그래프로 생각의 연결을 보고, 플래너로 하루를 정리하는 개인 메모·플래너 앱'
export const CONTACT_EMAIL = 'dltjrrhs22@gmail.com'
export const PRIVACY_OFFICER = '석곤'
/** 개인정보 처리방침·이용약관 시행일 — 내용을 바꾸면 함께 바꾼다 */
export const POLICY_EFFECTIVE_DATE = '2026년 11월 7일'

export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'http://localhost:3000')
).replace(/\/$/, '')

/** 로그인 없이 열리는 페이지 — proxy.ts·robots·sitemap이 같은 목록을 쓴다 */
export const PUBLIC_PAGES = ['/', '/privacy', '/terms'] as const

export function isPublicPage(pathname: string): boolean {
  return pathname === '/' || pathname === '/privacy' || pathname === '/terms'
}
