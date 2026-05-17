import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Sidebar from '@/components/layout/Sidebar'
import Header from '@/components/layout/Header'
import MobileNav from '@/components/layout/MobileNav'
import DarkModeProvider from '@/components/layout/DarkModeProvider'
import SidebarSpacer from '@/components/layout/SidebarSpacer'
import QueryProvider from '@/components/providers/QueryProvider'
import { MemoListPrefetch } from '@/components/providers/MemoListPrefetch'

export default async function MainLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  // proxy.ts 미들웨어가 이미 getUser()로 검증하므로 여기서는 getSession()으로 충분
  // getSession()은 쿠키의 JWT를 로컬 파싱만 해서 네트워크 요청 없이 즉각 반환
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) redirect('/login')

  const userEmail = session.user.email ?? ''

  return (
    <QueryProvider>
    <MemoListPrefetch />
    <DarkModeProvider>
      <div className="flex h-screen overflow-hidden bg-gray-50 dark:bg-gray-950">
        <Sidebar userEmail={userEmail} />
        <SidebarSpacer />

        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          <Header />
          <main className="flex-1 overflow-y-auto pb-16 md:pb-0">
            {children}
          </main>
        </div>

        <MobileNav />
      </div>
    </DarkModeProvider>
    </QueryProvider>
  )
}
