import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Sidebar from '@/components/layout/Sidebar'
import Header from '@/components/layout/Header'
import MobileNav from '@/components/layout/MobileNav'
import DarkModeProvider from '@/components/layout/DarkModeProvider'
import SidebarSpacer from '@/components/layout/SidebarSpacer'
import KeyboardShortcuts from '@/components/layout/KeyboardShortcuts'
import NotificationScheduler from '@/components/layout/NotificationScheduler'
import AutofillBlocker from '@/components/layout/AutofillBlocker'
import QueryProvider from '@/components/providers/QueryProvider'
import { MemoListPrefetch } from '@/components/providers/MemoListPrefetch'
import { SyncBootstrap } from '@/components/providers/SyncBootstrap'
import { ToastProvider } from '@/components/providers/ToastProvider'
import { ActivityPing } from '@/components/providers/ActivityPing'
import { OfflineBanner } from '@/components/layout/OfflineBanner'
import QuickCaptureFAB from '@/components/quick-capture/QuickCaptureFAB'
import QuickCaptureModal from '@/components/quick-capture/QuickCaptureModal'
import { AppShellWatcher } from '@/components/providers/AppShellWatcher'
import { TabWarmup } from '@/components/providers/TabWarmup'

// sw.js가 저장해 둔 홈 셸은 서버(proxy)를 거치지 않고 뜬다 — 이 기기에서 로그아웃해 로그인 쿠키가 없으면
// 첫 페인트 전에 로그인 화면으로 보낸다(예전 화면이 잠깐도 보이지 않게). 서버에서 온 HTML이면 항상 통과.
const NO_SESSION_REDIRECT =
  "try{if(!/(?:^|; )sb-[^=]*-auth-token(?:\\.0)?=/.test(document.cookie)){location.replace('/login')}}catch(e){}"

export default async function MainLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  // proxy.ts 미들웨어가 이미 getUser()로 검증하므로 여기서는 getSession()으로 충분
  // getSession()은 쿠키의 JWT를 로컬 파싱만 해서 네트워크 요청 없이 즉각 반환
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) redirect('/login')

  const userEmail = session.user.email ?? ''
  const userName = (session.user.user_metadata?.display_name as string | undefined)
    || userEmail.split('@')[0]
    || ''

  return (
    <QueryProvider>
    <script dangerouslySetInnerHTML={{ __html: NO_SESSION_REDIRECT }} />
    <AppShellWatcher />
    <ToastProvider />
    <SyncBootstrap />
    <ActivityPing />
    <OfflineBanner />
    <MemoListPrefetch />
    <TabWarmup />
    <DarkModeProvider>
      <div className="flex h-screen overflow-hidden bg-gray-50 dark:bg-gray-950">
        <Sidebar userEmail={userEmail} userName={userName} />
        <SidebarSpacer />

        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <Header />
          <main data-scroll-root="main" className="flex-1 overflow-y-auto pb-16 md:pb-0">
            {children}
          </main>
        </div>

        <MobileNav />
        <KeyboardShortcuts />
        <AutofillBlocker />
        <NotificationScheduler />
        <QuickCaptureFAB />
        <QuickCaptureModal />
      </div>
    </DarkModeProvider>
    </QueryProvider>
  )
}
