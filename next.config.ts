import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  turbopack: {},
  // Google 원탭(GIS)용 공개 클라이언트 ID — 서버 환경변수 GOOGLE_CLIENT_ID를 빌드 때 넣는다.
  // 클라이언트 ID는 공개 값(브라우저에 그대로 보임)이고, 비밀은 GOOGLE_CLIENT_SECRET뿐이다.
  // Supabase Google provider와 같은 클라이언트여야 signInWithIdToken이 통과한다.
  env: {
    NEXT_PUBLIC_GOOGLE_CLIENT_ID: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID ?? '',
    // 빌드 시각 — sw.js가 저장한 홈 셸이 지금 코드보다 새 버전인지 비교(lib/pwa/homeShell). dev는 0
    NEXT_PUBLIC_BUILD_TIME: process.env.NODE_ENV === 'production' ? String(Date.now()) : '0',
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.r2.dev' },
      { protocol: 'https', hostname: '*.r2.cloudflarestorage.com' },
      { protocol: 'https', hostname: '*.supabase.co' },
      { protocol: 'https', hostname: '*.supabase.in' },
    ],
  },
  // 탭 화면은 모두 클라이언트 컴포넌트라 서버 화면 정보(RSC)가 사실상 바뀌지 않는다 →
  // 한 번 열었던 화면(앱을 처음 연 화면 포함)은 5분 동안 서버에 다시 묻지 않고 바로 바꾼다 (기본 0초).
  experimental: {
    staleTimes: { dynamic: 300 },
  },
  compiler: {
    removeConsole: { exclude: ['error'] },
  },
}

export default nextConfig
