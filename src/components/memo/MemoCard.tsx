'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Pin, Star, Lock, Trash2, MoreVertical, Unlock, RotateCcw } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { ko } from 'date-fns/locale'
import { cn } from '@/lib/utils'
import LockModal from './LockModal'
import type { Memo } from '@/types'

interface MemoCardProps {
  memo: Memo
  onPin: (id: string, current: boolean) => void
  onStar: (id: string, current: boolean) => void
  onDelete: (id: string) => void
  onLock: (id: string, content: Record<string, unknown>, password: string) => Promise<void>
  onUnlock: (id: string, lockedContent: string, password: string) => Promise<void>
  onRestore: (id: string) => void
  onPermanentDelete: (id: string) => void
  view: 'card' | 'list'
  isTrash?: boolean
}

export default function MemoCard({ memo, onPin, onStar, onDelete, onLock, onUnlock, onRestore, onPermanentDelete, view, isTrash = false }: MemoCardProps) {
  const router = useRouter()
  const [menuOpen, setMenuOpen] = useState(false)
  const [lockModal, setLockModal] = useState<'lock' | 'unlock' | null>(null)

  const timeAgo = formatDistanceToNow(new Date(memo.updatedAt), { addSuffix: true, locale: ko })

  function handleClick() {
    if (isTrash) return
    if (memo.isLocked) {
      setLockModal('unlock')
    } else {
      router.push(`/memo/${memo.id}`)
    }
  }

  async function handleUnlock(password: string) {
    await onUnlock(memo.id, memo.lockedContent!, password)
    router.push(`/memo/${memo.id}`)
  }

  if (view === 'list') {
    return (
      <>
        <div
          className="group flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer border-b border-gray-100 dark:border-gray-800 transition-colors"
          onClick={handleClick}
        >
          {memo.isLocked && <Lock size={13} className="text-amber-500 flex-shrink-0" />}
          <div className="flex-1 min-w-0">
            <span className={cn('text-sm font-medium text-gray-800 dark:text-gray-200 truncate block', !memo.title && 'text-gray-400 dark:text-gray-500 italic')}>
              {memo.title || '제목 없음'}
            </span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {memo.isPinned && <Pin size={12} className="text-violet-500" />}
            {memo.isStarred && <Star size={12} className="text-amber-400 fill-amber-400" />}
            <span className="text-xs text-gray-400">{timeAgo}</span>
            <CardMenu
              memo={memo}
              isTrash={isTrash}
              onPin={onPin}
              onStar={onStar}
              onDelete={onDelete}
              onRestore={onRestore}
              onPermanentDelete={onPermanentDelete}
              onLockClick={() => setLockModal(memo.isLocked ? 'unlock' : 'lock')}
              open={menuOpen}
              setOpen={setMenuOpen}
            />
          </div>
        </div>
        {lockModal && (
          <LockModal
            mode={lockModal}
            onConfirm={lockModal === 'unlock' ? handleUnlock : (pw) => onLock(memo.id, memo.content, pw)}
            onClose={() => setLockModal(null)}
          />
        )}
      </>
    )
  }

  return (
    <>
      <div
        className="group relative bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 cursor-pointer hover:shadow-md hover:border-violet-200 dark:hover:border-violet-800 transition-all"
        onClick={handleClick}
      >
        {/* 고정 배지 */}
        {memo.isPinned && (
          <Pin size={12} className="absolute top-3 right-3 text-violet-500" />
        )}

        {/* 잠금 상태 */}
        {memo.isLocked ? (
          <div className="flex flex-col items-center justify-center py-4 gap-2 text-gray-400">
            <Lock size={24} className="text-amber-400" />
            <span className="text-xs">잠긴 메모</span>
          </div>
        ) : (
          <>
            <h3 className={cn(
              'text-sm font-semibold text-gray-800 dark:text-gray-200 mb-1.5 truncate',
              !memo.title && 'text-gray-400 dark:text-gray-500 italic font-normal'
            )}>
              {memo.title || '제목 없음'}
            </h3>
            {memo.contentText && (
              <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-3 leading-relaxed">
                {memo.contentText}
              </p>
            )}
          </>
        )}

        {/* 하단: 날짜 + 뱃지 + 메뉴 */}
        <div className="flex items-center justify-between mt-3">
          <span className="text-xs text-gray-400">{timeAgo}</span>
          <div className="flex items-center gap-1.5">
            {memo.isStarred && <Star size={12} className="text-amber-400 fill-amber-400" />}
            <CardMenu
              memo={memo}
              isTrash={isTrash}
              onPin={onPin}
              onStar={onStar}
              onDelete={onDelete}
              onRestore={onRestore}
              onPermanentDelete={onPermanentDelete}
              onLockClick={() => setLockModal(memo.isLocked ? 'unlock' : 'lock')}
              open={menuOpen}
              setOpen={setMenuOpen}
            />
          </div>
        </div>
      </div>

      {lockModal && (
        <LockModal
          mode={lockModal}
          onConfirm={lockModal === 'unlock' ? handleUnlock : (pw) => onLock(memo.id, memo.content, pw)}
          onClose={() => setLockModal(null)}
        />
      )}
    </>
  )
}

function CardMenu({
  memo, isTrash = false, onPin, onStar, onDelete, onRestore, onPermanentDelete, onLockClick, open, setOpen,
}: {
  memo: Memo
  isTrash?: boolean
  onPin: (id: string, current: boolean) => void
  onStar: (id: string, current: boolean) => void
  onDelete: (id: string) => void
  onRestore: (id: string) => void
  onPermanentDelete: (id: string) => void
  onLockClick: () => void
  open: boolean
  setOpen: (v: boolean) => void
}) {
  return (
    <div className="relative">
      <button
        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 transition-opacity"
        onClick={(e) => { e.stopPropagation(); setOpen(!open) }}
      >
        <MoreVertical size={13} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); setOpen(false) }} />
          <div className="absolute right-0 bottom-6 z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg py-1 w-40">
            {isTrash ? (
              <>
                <MenuItem
                  icon={<RotateCcw size={13} />}
                  label="복원"
                  onClick={() => { setOpen(false); onRestore(memo.id) }}
                />
                <hr className="my-1 border-gray-100 dark:border-gray-700" />
                <MenuItem
                  icon={<Trash2 size={13} />}
                  label="영구 삭제"
                  danger
                  onClick={() => {
                    setOpen(false)
                    if (confirm('영구 삭제하면 복구할 수 없습니다. 삭제할까요?')) onPermanentDelete(memo.id)
                  }}
                />
              </>
            ) : (
              <>
                <MenuItem icon={<Pin size={13} />} label={memo.isPinned ? '고정 해제' : '고정'} onClick={() => { onPin(memo.id, memo.isPinned); setOpen(false) }} />
                <MenuItem icon={<Star size={13} />} label={memo.isStarred ? '중요 해제' : '중요'} onClick={() => { onStar(memo.id, memo.isStarred); setOpen(false) }} />
                <MenuItem
                  icon={memo.isLocked ? <Unlock size={13} /> : <Lock size={13} />}
                  label={memo.isLocked ? '잠금 해제' : '잠금'}
                  onClick={() => { onLockClick(); setOpen(false) }}
                />
                <hr className="my-1 border-gray-100 dark:border-gray-700" />
                <MenuItem icon={<Trash2 size={13} />} label="삭제" danger onClick={() => { setOpen(false); if (confirm('메모를 삭제할까요?')) onDelete(memo.id) }} />
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function MenuItem({ icon, label, onClick, danger = false }: {
  icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean
}) {
  return (
    <button
      className={cn(
        'w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors',
        danger
          ? 'text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30'
          : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
      )}
      onClick={(e) => { e.stopPropagation(); onClick() }}
    >
      {icon}{label}
    </button>
  )
}
