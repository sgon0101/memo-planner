'use client'

// 루트 레이아웃까지 죽는 치명적 렌더 에러 폴백 + Sentry 보고
// (일반 에러는 Next가 상위 error boundary에서 처리 — 이 파일은 최후 방어선)

import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <html lang="ko">
      <body style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', fontFamily: 'sans-serif', background: '#F9FAFB' }}>
        <div style={{ textAlign: 'center', padding: 24 }}>
          <p style={{ fontSize: 40, margin: 0 }}>😵</p>
          <h2 style={{ fontSize: 18, color: '#374151', margin: '12px 0 6px' }}>문제가 발생했어요</h2>
          <p style={{ fontSize: 13, color: '#9CA3AF', margin: '0 0 16px' }}>
            일시적인 오류일 수 있어요. 다시 시도해주세요.
          </p>
          <button
            onClick={reset}
            style={{ padding: '8px 20px', borderRadius: 8, border: 'none', background: '#7C3AED', color: '#fff', fontSize: 14, cursor: 'pointer' }}
          >
            다시 시도
          </button>
        </div>
      </body>
    </html>
  )
}
