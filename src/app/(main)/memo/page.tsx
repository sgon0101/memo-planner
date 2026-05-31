import FolderPanel from '@/components/memo/FolderPanel'
import MemoList from '@/components/memo/MemoList'

/**
 * 메모 페이지 — SSR 제거 + static import로 navigation 즉시 전환
 *
 * 데이터 흐름:
 *   1. 페이지 클릭 → HTML 즉시 반환 (서버 측 fetch 없음)
 *   2. React mount → useMemos가 localStorage initialData 즉시 표시
 *      OR React Query cache (MemoListPrefetch가 layout에서 미리 채움) 활용
 *   3. 백그라운드에서 staleTime(5분) 만료 시 refetch
 *
 * 이전 SSR 방식 대비:
 *   - navigation 대기 시간 0ms (이전 100~500ms)
 *   - 데이터: 캐시 있으면 즉시, 없으면 짧은 스피너 (대부분 케이스에 캐시 있음)
 */
export default function MemoPage() {
  return (
    <div className="flex h-full">
      <aside className="w-52 flex-shrink-0 border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hidden sm:flex flex-col">
        <FolderPanel />
      </aside>
      <div className="flex-1 min-w-0">
        <MemoList />
      </div>
    </div>
  )
}
