import { Suspense } from 'react'
import FolderPanel from '@/components/memo/FolderPanel'
import { MemoListSkeleton } from '@/components/ui/Skeleton'
import MemoDataFetcher from './_fetcher'

export default function MemoPage() {
  return (
    <div className="flex h-full">
      <aside className="w-52 flex-shrink-0 border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hidden sm:flex flex-col">
        <FolderPanel />
      </aside>
      <div className="flex-1 min-w-0">
        {/*
          Suspense: HTML 쉘(FolderPanel + 스켈레톤)을 즉각 전송
          MemoDataFetcher가 서버에서 Supabase fetch 완료 후 스트리밍으로 전달
        */}
        <Suspense fallback={<MemoListSkeleton />}>
          <MemoDataFetcher />
        </Suspense>
      </div>
    </div>
  )
}
