// Next.js instrumentation hook — 서버(nodejs/edge) Sentry 초기화
// NEXT_PUBLIC_SENTRY_DSN이 없으면 완전 no-op (개발/미설정 환경 무해)
// withSentryConfig 없이 최소 구성 — Turbopack 빌드 리스크 회피,
// 서버 에러는 onRequestError 훅으로 수집

import * as Sentry from '@sentry/nextjs'

export async function register() {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return

  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    tracesSampleRate: 0.1, // 성능 추적 10% 샘플링 (에러는 100% 수집)
  })
}

// App Router 서버 에러(RSC/route handler) 자동 수집
export const onRequestError = Sentry.captureRequestError
