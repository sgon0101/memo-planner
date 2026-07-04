// 클라이언트 Sentry 초기화 — Next 15.3+가 자동 로드하는 파일
// NEXT_PUBLIC_SENTRY_DSN이 없으면 완전 no-op

import * as Sentry from '@sentry/nextjs'

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0.1,
    // 세션 리플레이 비활성 — 개인 메모 앱 특성상 화면 녹화 수집 안 함 (프라이버시)
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
  })
}

// 라우터 전환 성능 계측 (DSN 없으면 Sentry 내부에서 no-op)
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart
