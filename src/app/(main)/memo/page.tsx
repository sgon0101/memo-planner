import { dehydrate, HydrationBoundary, QueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/server'
import { LIST_COLS, toMemo } from '@/lib/memos/shared'
import FolderPanel from '@/components/memo/FolderPanel'
import MemoList from '@/components/memo/MemoList'

export default async function MemoPage() {
  const supabase = await createClient()
  const queryClient = new QueryClient()

  // 서버에서 전체 메모 prefetch → 클라이언트 마운트 시 캐시 히트, 로딩 없음
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

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <div className="flex h-full">
        {/* 폴더 패널 */}
        <aside className="w-52 flex-shrink-0 border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hidden sm:flex flex-col">
          <FolderPanel />
        </aside>

        {/* 메모 목록 */}
        <div className="flex-1 min-w-0">
          <MemoList />
        </div>
      </div>
    </HydrationBoundary>
  )
}
