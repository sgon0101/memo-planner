import dynamic from 'next/dynamic'
import { dehydrate, HydrationBoundary, QueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/server'
import { LIST_COLS, toMemo } from '@/lib/memos/shared'
import FolderPanel from '@/components/memo/FolderPanel'
import { MemoListSkeleton } from '@/components/ui/Skeleton'

const MemoList = dynamic(() => import('@/components/memo/MemoList'), {
  loading: () => <MemoListSkeleton />,
})

export default async function MemoPage() {
  // ─────────────────────────────────────────────────────────────
  // SSR 메모 prefetch — /memo 페이지에서만 적용 (다른 페이지는 cost 안 듦)
  //
  // 사전 조건 (모두 충족):
  //   ✅ Vercel sin1 + Supabase ap-southeast-1 (same region, RTT ~30ms)
  //   ✅ LIST_COLS = content_preview (페이로드 ~150KB)
  //   ✅ try-catch graceful fallback
  //
  // 효과:
  //   - /memo 첫 진입 시 메모 fetch 1.75s → ~30ms 서버 흡수
  //   - Preflight CORS 제거
  //   - 클라이언트가 hydrated cache 즉시 사용 (스피너 없음)
  //   - 다른 페이지(/home, /planner 등)는 영향 없음
  // ─────────────────────────────────────────────────────────────
  const supabase = await createClient()
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
    <HydrationBoundary state={dehydratedState}>
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
