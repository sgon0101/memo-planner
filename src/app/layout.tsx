import type { Metadata, Viewport } from 'next'
// 폰트는 npm에 든 파일을 쓴다(@fontsource). next/font/google은 빌드 때마다 Google Fonts에서 받아오는데,
// Vercel 빌드에서 이 요청이 실패해 배포가 깨진 적이 두 번 있다(2026-11-07 JetBrains Mono, 2026-11-08 Noto Sans KR).
// 한글은 unicode-range로 나뉘어 있어 화면에 쓰인 글자 조각만 내려받는다.
import '@fontsource-variable/noto-sans-kr'
import '@fontsource-variable/jetbrains-mono'
import './globals.css'
import ServiceWorkerRegister from '@/components/layout/ServiceWorkerRegister'

export const metadata: Metadata = {
  title: 'Weave',
  description: '경험을 모으고 엮어 더 나은 나로',
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: '/favicon.ico' },
      { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Weave',
  },
}

export const viewport: Viewport = {
  themeColor: '#7F77DD',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    // suppressHydrationWarning: 아래 pre-paint 스크립트가 hydration 전에 html에
    // dark 클래스를 넣으므로, html 요소의 속성 불일치 경고만 억제 (자식에는 미적용)
    <html lang="ko" className="h-full antialiased" suppressHydrationWarning>
      <head>
        {/* Supabase API 서버에 대한 TCP+TLS 연결을 HTML 파싱 시점부터 미리 시작 */}
        <link rel="preconnect" href={process.env.NEXT_PUBLIC_SUPABASE_URL} />
        <link rel="dns-prefetch" href={process.env.NEXT_PUBLIC_SUPABASE_URL} />
        {/* 다크모드 FOUC 제거 — 첫 페인트 전에 persist(memo-planner-ui)를 읽어 dark 클래스 적용.
            DarkModeProvider(effect)는 토글 반응용으로 유지 (idempotent) */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var s=JSON.parse(localStorage.getItem('memo-planner-ui'));if(s&&s.state&&s.state.darkMode){document.documentElement.classList.add('dark')}}catch(e){}",
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  )
}
