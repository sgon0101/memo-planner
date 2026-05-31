import { redirect } from 'next/navigation'
import { dehydrate, HydrationBoundary, QueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/server'
import { LIST_COLS, toMemo } from '@/lib/memos/shared'
import Sidebar from '@/components/layout/Sidebar'
import Header from '@/components/layout/Header'
import MobileNav from '@/components/layout/MobileNav'
import DarkModeProvider from '@/components/layout/DarkModeProvider'
import SidebarSpacer from '@/components/layout/SidebarSpacer'
import KeyboardShortcuts from '@/components/layout/KeyboardShortcuts'
import NotificationScheduler from '@/components/layout/NotificationScheduler'
import QueryProvider from '@/components/providers/QueryProvider'
import { MemoListPrefetch } from '@/components/providers/MemoListPrefetch'
import QuickCaptureFAB from '@/components/quick-capture/QuickCaptureFAB'
import QuickCaptureModal from '@/components/quick-capture/QuickCaptureModal'

export default async function MainLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  // proxy.ts 미들웨어가 이미 getUser()로 검증하므로 여기서는 getSession()으로 충분
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) redirect('/login')

  const userEmail = session.user.email ?? ''
  const userName = (session.user.user_metadata?.display_name as string | undefined)
    || userEmail.split('@')[0]
    || ''

  // ─────────────────────────────────────────────────────────────
  // SSR 메모 prefetch — 첫 진입 시 클라이언트 fetch 단계 제거
  //
  // 사전 조건 (모두 충족됨 2026-05-29):
  //   ✅ Vercel sin1 + Supabase ap-southeast-1 (same region, RTT ~30ms)
  //   ✅ LIST_COLS = content_preview (페이로드 ~150KB, 80% 감량)
  //   ✅ try-catch 그레이스풀 폴백
  //
  // 효과 (DevTools Network 측정 기준):
  //   - 클라이언트 메모 fetch 1.75s → 서버 fetch ~30ms로 흡수
  //   - Preflight CORS 5개+ 제거 (서버 fetch는 CORS 무관)
  //   - 첫 페인트와 동시에 메모 즉시 노출
  // ─────────────────────────────────────────────────────────────
  const queryClient = new QueryClient()
  try {
    await queryClient.prefetchQuery({
      queryKey: ['memos', 'all', false],
      queryFn: async () => {
        const { data } = await supabase
          .from('memos')
          .select(LIST_COLS)
          .eq('is_deleted', false)
          .order('is_pinned', { ascending: false })
          .order('updated_at', { ascending: false })
        return (data ?? []).map(toMemo)
      },
    })
  } catch {
    // 실패 시 client useQuery가 정상 폴백
  }
  const dehydratedState = dehydrate(queryClient)

  return (
    <QueryProvider>
      <HydrationBoundary state={dehydratedState}>
        <MemoListPrefetch />
        <DarkModeProvider>
          <div className="flex h-screen overflow-hidden bg-gray-50 dark:bg-gray-950">
            <Sidebar userEmail={userEmail} userName={userName} />
            <SidebarSpacer />

            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
              <Header />
              <main className="flex-1 overflow-y-auto pb-16 md:pb-0">
                {children}
              </main>
            </div>

            <MobileNav />
            <KeyboardShortcuts />
            <NotificationScheduler />
            <QuickCaptureFAB />
            <QuickCaptureModal />
          </div>
        </DarkModeProvider>
      </HydrationBoundary>
    </QueryProvider>
  )
}
