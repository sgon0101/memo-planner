import dynamic from 'next/dynamic'
import FolderPanel from '@/components/memo/FolderPanel'
import { MemoListSkeleton } from '@/components/ui/Skeleton'

const MemoList = dynamic(() => import('@/components/memo/MemoList'), {
  loading: () => <MemoListSkeleton />,
})

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
