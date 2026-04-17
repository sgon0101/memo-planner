import FolderPanel from '@/components/memo/FolderPanel'

export default function MemoPage() {
  return (
    <div className="flex h-full">
      {/* 폴더 패널 */}
      <aside className="w-52 flex-shrink-0 border-r border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 hidden sm:flex flex-col">
        <FolderPanel />
      </aside>

      {/* 메모 목록 영역 (6단계에서 구현) */}
      <main className="flex-1 flex items-center justify-center text-gray-400 dark:text-gray-600 text-sm">
        폴더를 선택하거나 메모를 만들어보세요
      </main>
    </div>
  )
}
