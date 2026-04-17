'use client'

import { useEffect } from 'react'
import { X, RotateCcw, Trash2, Clock } from 'lucide-react'
import { format } from 'date-fns'
import { ko } from 'date-fns/locale'
import { useVersions } from '@/hooks/useVersions'
import type { MemoVersion } from '@/types'

interface VersionHistoryProps {
  memoId: string
  onRestore: (version: MemoVersion) => void
  onClose: () => void
}

export default function VersionHistory({ memoId, onRestore, onClose }: VersionHistoryProps) {
  const { versions, load, deleteVersion } = useVersions(memoId)

  useEffect(() => { load() }, [load])

  function formatDate(iso: string) {
    return format(new Date(iso), 'M월 d일 HH:mm', { locale: ko })
  }

  return (
    <div className="flex flex-col h-full w-64 border-l border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800">
        <div className="flex items-center gap-2">
          <Clock size={14} className="text-violet-500" />
          <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">버전 이력</span>
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
          <X size={15} />
        </button>
      </div>

      {/* 버전 목록 */}
      <div className="flex-1 overflow-y-auto">
        {versions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-2">
            <Clock size={24} className="opacity-40" />
            <p className="text-xs">저장된 버전이 없습니다</p>
            <p className="text-xs text-center opacity-70 px-4">편집 후 자동으로 버전이<br />저장됩니다</p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {versions.map((ver, i) => (
              <li key={ver.id} className="group flex items-start gap-2 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">
                    {ver.title || '제목 없음'}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">{formatDate(ver.createdAt)}</p>
                  {i === 0 && (
                    <span className="inline-block mt-1 text-[10px] bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 px-1.5 py-0.5 rounded">
                      최신
                    </span>
                  )}
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                  <button
                    onClick={() => {
                      if (confirm('이 버전으로 복원할까요? 현재 내용은 새 버전으로 저장됩니다.')) {
                        onRestore(ver)
                      }
                    }}
                    title="이 버전으로 복원"
                    className="p-1 rounded hover:bg-violet-100 dark:hover:bg-violet-900/30 text-violet-500 transition-colors"
                  >
                    <RotateCcw size={13} />
                  </button>
                  <button
                    onClick={() => deleteVersion(ver.id)}
                    title="이 버전 삭제"
                    className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-950/30 text-red-400 transition-colors"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="px-4 py-3 border-t border-gray-200 dark:border-gray-800">
        <p className="text-xs text-gray-400 text-center">최대 {versions.length}/20 버전 보관</p>
      </div>
    </div>
  )
}
