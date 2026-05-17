import { dehydrate, HydrationBoundary, QueryClient } from '@tanstack/react-query'
import dynamic from 'next/dynamic'
import FolderPanel from '@/components/memo/FolderPanel'
import { MemoListSkeleton } from '@/components/ui/Skeleton'
import { createClient } from '@/lib/supabase/server'
import { LIST_COLS, toMemo } from '@/lib/memos/shared'

const MemoList = dynamic(() => import('@/components/memo/MemoList'), {
  loading: () => <MemoListSkeleton />,
})

// memoKeys.all()과 동일한 키 — 'use client' 없이 서버에서 직접 사용
const MEMO_ALL_KEY = ['memos', 'all', false] as const

export default async function MemoPage() {
  const queryClient = new QueryClient()

  try {
    const supabase = await createClient()
    const { data } = await supabase
      .from('memos')
      .select(LIST_COLS)
      .eq('is_deleted', false)
      .order('is_pinned', { ascending: false })
      .order('updated_at', { ascending: false })

    queryClient.setQueryData(MEMO_ALL_KEY, (data ?? []).map(toMemo))
  } catch {
    // SSR fetch 실패 시 클라이언트에서 재시도
  }

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <div className="flex h-full">
        <aside className="w-52 flex-shrink-0 border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hidden sm:flex flex-col">
          <FolderPanel />
        </aside>
        <div className="flex-1 min-w-0">
          <MemoList />
        </div>
      </div>
    </HydrationBoundary>
  )
}
