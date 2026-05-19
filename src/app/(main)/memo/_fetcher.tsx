import { dehydrate, HydrationBoundary, QueryClient } from '@tanstack/react-query'
import dynamic from 'next/dynamic'
import { createClient } from '@/lib/supabase/server'
import { LIST_COLS, toMemo } from '@/lib/memos/shared'
import { MemoListSkeleton } from '@/components/ui/Skeleton'

// module scope — 렌더마다 재생성 방지
const MemoList = dynamic(() => import('@/components/memo/MemoList'), {
  loading: () => <MemoListSkeleton />,
})

// useMemos / memoKeys.all()과 동일한 키
const MEMO_ALL_KEY = ['memos', 'all', false] as const

// 이 컴포넌트는 page.tsx의 Suspense 안에서 렌더됨
// → HTML 쉘(스켈레톤)이 먼저 전송된 뒤 이 fetch가 완료되면 스트리밍으로 전달
export default async function MemoDataFetcher() {
  const queryClient = new QueryClient()

  try {
    const supabase = await createClient()
    const { data, error } = await supabase
      .from('memos')
      .select(LIST_COLS)
      .eq('is_deleted', false)
      .order('is_pinned', { ascending: false })
      .order('updated_at', { ascending: false })

    // error가 있으면 throw → catch에서 setQueryData 호출 안 함
    // → HydrationBoundary가 빈 state 전달 → useMemos가 initialData(localStorage) fallback 사용
    if (error) throw error
    queryClient.setQueryData(MEMO_ALL_KEY, (data ?? []).map(toMemo))
  } catch {
    // 서버 fetch 실패 → queryClient에 데이터 없음 → 클라이언트 fallback 동작
  }

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <MemoList />
    </HydrationBoundary>
  )
}
