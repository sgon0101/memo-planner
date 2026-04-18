import type { Metadata, Viewport } from 'next'
import { Noto_Sans_KR, JetBrains_Mono } from 'next/font/google'
import './globals.css'
import ServiceWorkerRegister from '@/components/layout/ServiceWorkerRegister'

const notoSansKR = Noto_Sans_KR({
  variable: '--font-sans',
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  display: 'swap',
})

const jetbrainsMono = JetBrains_Mono({
  variable: '--font-mono',
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
})

export const metadata: Metadata = {
  title: '나만의 메모 플래너',
  description: '메모장 + 플래너 통합 AI 시스템',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: '메모 플래너',
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
    <html lang="ko" className={`${notoSansKR.variable} ${jetbrainsMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  )
}
