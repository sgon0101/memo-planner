import type { Metadata, Viewport } from 'next'
import { Noto_Sans_KR } from 'next/font/google'
// JetBrains Mono는 npm에 든 폰트 파일을 쓴다 — next/font/google로 받으면 Vercel 빌드 때 Google에서 못 받아와 실패한 적이 있다(2026-11-07)
import '@fontsource-variable/jetbrains-mono'
import './globals.css'
import ServiceWorkerRegister from '@/components/layout/ServiceWorkerRegister'

const notoSansKR = Noto_Sans_KR({
  variable: '--font-noto', // globals.css의 --font-sans가 이 값을 쓴다 (같은 이름이면 서로 덮어써 의도한 폰트가 안 나옴)
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  display: 'swap',
})

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
    <html lang="ko" className={`${notoSansKR.variable} h-full antialiased`} suppressHydrationWarning>
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
