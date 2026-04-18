import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Sidebar from '@/components/layout/Sidebar'
import Header from '@/components/layout/Header'
import MobileNav from '@/components/layout/MobileNav'
import DarkModeProvider from '@/components/layout/DarkModeProvider'
import SidebarSpacer from '@/components/layout/SidebarSpacer'
import QueryProvider from '@/components/providers/QueryProvider'

export default async function MainLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const userEmail = user.email ?? ''

  return (
    <QueryProvider>
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
