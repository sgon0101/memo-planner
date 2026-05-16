'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Pin, Star, Lock, Trash2, MoreVertical, Unlock, RotateCcw, FolderInput, Folder, ChevronRight } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { ko } from 'date-fns/locale'
import { cn } from '@/lib/utils'
import { useFolderStore } from '@/store/folderStore'
import { useDragStore } from '@/store/dragStore'
import LockModal from './LockModal'
import type { Memo } from '@/types'

// thumbnail_url이 md_(960w)일 때만 srcset 생성 — 3개 변형이 모두 R2에 존재함을 보장
function toSrcSet(url: string | null): string | undefined {
  if (!url?.includes('/md_')) return undefined
  const sm   = url.replace('/md_', '/thumb_')
  const full = url.replace(/\/md_([^/]+\.webp)$/, '/$1')
  return `${sm} 480w, ${url} 960w, ${full} 1920w`
}

function extractTagsFromText(text: string): string[] {
  if (!text) return []
  const matches = text.match(/#[\w가-힣]+/g) ?? []
  return [...new Set(matches.map((t) => t.slice(1)))]
}

function getMemeTags(memo: Memo): string[] {
  if (memo.tags && memo.tags.length > 0) return memo.tags
  return extractTagsFromText(memo.contentText ?? '')
}


interface MemoCardProps {
  memo: Memo
  onPin: (id: string, current: boolean) => void
  onStar: (id: string, current: boolean) => void
  onDelete: (id: string) => void
  onLock: (id: string, content: Record<string, unknown>, password: string) => Promise<void>
  onUnlock: (id: string, lockedContent: string, password: string) => Promise<void>
  onRestore: (id: string) => void
  onPermanentDelete: (id: string) => void
  onMoveToFolder?: (id: string, folderId: string | null) => void
  view: 'card' | 'list'
  isTrash?: boolean
  isSelected?: boolean
  onToggleSelect?: (id: string) => void
}

export default function MemoCard({ memo, onPin, onStar, onDelete, onLock, onUnlock, onRestore, onPermanentDelete, onMoveToFolder, view, isTrash = false, isSelected = false, onToggleSelect }: MemoCardProps) {
  const router = useRouter()
  const { folders } = useFolderStore()
  const { setDraggingMemo } = useDragStore()
  const [menuOpen, setMenuOpen] = useState(false)
  const [lockModal, setLockModal] = useState<'lock' | 'unlock' | null>(null)
  const [showFolderPicker, setShowFolderPicker] = useState(false)
  const [imgSrc, setImgSrc] = useState(memo.thumbnailUrl ?? null)
  const [imgVisible, setImgVisible] = useState(false)

  // React Query가 새 데이터를 가져오면 imgSrc 동기화 (마이그레이션·수정 반영)
  useEffect(() => {
    setImgSrc(memo.thumbnailUrl ?? null)
    setImgVisible(false)
  }, [memo.thumbnailUrl])
  const cardRef = useRef<HTMLDivElement>(null)

  function handleDragStart(e: React.DragEvent) {
    if (isTrash) return
    e.dataTransfer.setData('memoId', memo.id)
    e.dataTransfer.effectAllowed = 'move'
    setDraggingMemo(memo.id)
    const el = e.currentTarget as HTMLElement
    setTimeout(() => { el.style.opacity = '0.4' }, 0)
  }

  function handleDragEnd(e: React.DragEvent) {
    ;(e.currentTarget as HTMLElement).style.opacity = '1'
    setDraggingMemo(null)
  }

  const currentFolder = memo.folderId ? folders.find((f) => f.id === memo.folderId) : null
  const memeTags = getMemeTags(memo)

  const timeAgo = formatDistanceToNow(new Date(memo.updatedAt), { addSuffix: true, locale: ko })

  const trashDaysLeft = isTrash && memo.deletedAt
    ? Math.max(0, 30 - Math.floor((Date.now() - new Date(memo.deletedAt).getTime()) / 86400000))
    : null

  function handleClick() {
    if (isTrash) {
      onToggleSelect?.(memo.id)
      return
    }
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
          ref={cardRef}
          draggable={!isTrash}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          className={cn(
            'group flex items-center gap-3 px-4 py-2.5 cursor-pointer border-b border-gray-100 dark:border-gray-800 transition-colors',
            isSelected
              ? 'bg-violet-50 dark:bg-violet-950/20 hover:bg-violet-100 dark:hover:bg-violet-950/30'
              : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
          )}
          onClick={handleClick}
        >
          {isTrash && onToggleSelect && (
            <div onClick={(e) => e.stopPropagation()}>
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => onToggleSelect(memo.id)}
                className="w-4 h-4 accent-violet-600 cursor-pointer flex-shrink-0"
              />
            </div>
          )}
          {memo.isLocked && <Lock size={13} className="text-amber-500 flex-shrink-0" />}
          <div className="flex-1 min-w-0">
            <span className={cn('text-sm font-medium text-gray-800 dark:text-gray-200 truncate block', !memo.title && 'text-gray-400 dark:text-gray-500 italic')}>
              {memo.title || '제목 없음'}
            </span>
            {currentFolder && (
              <span className="text-xs mt-0.5 flex items-center gap-0.5" style={{ color: `hsl(${currentFolder.colorH},${currentFolder.colorS}%,${currentFolder.colorL - 15}%)` }}>
                <Folder size={10} />
                {currentFolder.name}
              </span>
            )}
            {!memo.isLocked && memeTags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {memeTags.slice(0, 4).map((tag) => (
                  <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-50 dark:bg-violet-950/20 text-violet-500 dark:text-violet-400 border border-violet-200/50 dark:border-violet-700/40">
                    #{tag}
                  </span>
                ))}
                {memeTags.length > 4 && (
                  <span className="text-[10px] text-violet-400 opacity-70">+{memeTags.length - 4}</span>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {memo.isPinned && <Pin size={12} className="text-violet-500" />}
            {memo.isStarred && <Star size={12} className="text-amber-400 fill-amber-400" />}
            {trashDaysLeft !== null && (
              <span className={cn('text-xs px-1.5 py-0.5 rounded font-medium', trashDaysLeft <= 7 ? 'bg-red-100 dark:bg-red-950/30 text-red-500' : 'bg-yellow-100 dark:bg-yellow-950/30 text-yellow-600')}>
                {trashDaysLeft}일 후 삭제
              </span>
            )}
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
              onMoveToFolderClick={onMoveToFolder ? () => setShowFolderPicker(true) : undefined}
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
        {showFolderPicker && onMoveToFolder && (
          <FolderPickerPopup
            folders={folders}
            currentFolderId={memo.folderId}
            onSelect={(fid) => { onMoveToFolder(memo.id, fid); setShowFolderPicker(false) }}
            onClose={() => setShowFolderPicker(false)}
          />
        )}
      </>
    )
  }

  const thumbnail = !memo.isLocked ? imgSrc : null
  const thumbSrcSet = toSrcSet(imgSrc)

  return (
    <>
      <div
        ref={cardRef}
        draggable={!isTrash}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        className={cn(
          'group relative bg-white dark:bg-gray-800 rounded-xl border cursor-pointer hover:shadow-md transition-all overflow-hidden',
          isSelected
            ? 'border-violet-400 dark:border-violet-500 ring-2 ring-violet-200 dark:ring-violet-800'
            : 'border-gray-200 dark:border-gray-700 hover:border-violet-200 dark:hover:border-violet-800'
        )}
        onClick={handleClick}
      >
        {isTrash && onToggleSelect && (
          <div
            className="absolute top-2 left-2 z-10"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => onToggleSelect(memo.id)}
              className="w-4 h-4 accent-violet-600 cursor-pointer"
            />
          </div>
        )}
        {/* 이미지 썸네일 */}
        {thumbnail && (
          <div className="w-full aspect-video overflow-hidden bg-gray-200 dark:bg-gray-700 relative">
            {/* skeleton: 이미지 로드 전 placeholder */}
            {!imgVisible && (
              <div className="absolute inset-0 bg-gray-200 dark:bg-gray-700 animate-pulse" />
            )}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={thumbnail}
              srcSet={thumbSrcSet}
              sizes={thumbSrcSet
                ? '(max-width: 640px) 100vw, (max-width: 1024px) calc(50vw - 10rem), calc(33vw - 6rem)'
                : undefined}
              alt=""
              className={cn(
                'w-full h-full object-cover',
                imgVisible ? 'opacity-100' : 'opacity-0'
              )}
              ref={(el) => {
                // iOS Safari: 캐시된 이미지는 onLoad가 발생하지 않을 수 있음
                // ref callback으로 complete 상태를 직접 확인해서 즉시 표시
                if (el?.complete && el.naturalWidth > 0) setImgVisible(true)
              }}
              onLoad={() => setImgVisible(true)}
              onError={() => {
                // md_(960w) → thumb_(480w) → 원본(.webp) 순으로 fallback
                if (imgSrc?.includes('/md_')) {
                  setImgSrc(imgSrc.replace('/md_', '/thumb_'))
                  setImgVisible(false)
                } else if (imgSrc?.includes('/thumb_')) {
                  // /thumb_uuid.webp → /uuid.webp (확장자 유지)
                  const original = imgSrc.replace(/\/thumb_([^/]+\.webp)$/, '/$1')
                  setImgSrc(original !== imgSrc ? original : null)
                  setImgVisible(false)
                } else {
                  setImgSrc(null)
                }
              }}
            />
          </div>
        )}

        {/* 카드 본문 */}
        <div className="p-4 pb-3">
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
                <p className={cn('text-xs text-gray-500 dark:text-gray-400 leading-relaxed', thumbnail ? 'line-clamp-2' : 'line-clamp-3')}>
                  {memo.contentText}
                </p>
              )}
            </>
          )}
        </div>

        {/* 카드 하단 고정 영역 */}
        <div className="px-4 pb-3 border-t border-gray-100 dark:border-gray-700/60 pt-2.5 mt-auto">
          {/* 폴더 + 날짜 + 뱃지 + 메뉴 */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 min-w-0">
              {currentFolder && (
                <div className="flex items-center gap-0.5 min-w-0" style={{ color: `hsl(${currentFolder.colorH},${currentFolder.colorS}%,${currentFolder.colorL - 15}%)` }}>
                  <Folder size={10} className="flex-shrink-0" />
                  <span className="text-xs truncate max-w-[80px]">{currentFolder.name}</span>
                </div>
              )}
              <span className="text-xs text-gray-400">{timeAgo}</span>
              {trashDaysLeft !== null && (
                <span className={cn('text-xs px-1.5 py-0.5 rounded font-medium', trashDaysLeft <= 7 ? 'bg-red-100 dark:bg-red-950/30 text-red-500' : 'bg-yellow-100 dark:bg-yellow-950/30 text-yellow-600')}>
                  {trashDaysLeft}일
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
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
                onMoveToFolderClick={onMoveToFolder ? () => setShowFolderPicker(true) : undefined}
                open={menuOpen}
                setOpen={setMenuOpen}
              />
            </div>
          </div>

          {/* 태그 칩 고정 영역 */}
          {!memo.isLocked && memeTags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {memeTags.slice(0, 4).map((tag) => (
                <span key={tag} className="text-[10px] px-2 py-0.5 rounded-full bg-violet-50 dark:bg-violet-950/20 text-violet-500 dark:text-violet-400 border border-violet-200/50 dark:border-violet-700/40 whitespace-nowrap">
                  #{tag}
                </span>
              ))}
              {memeTags.length > 4 && (
                <span className="text-[10px] text-violet-400 opacity-70">+{memeTags.length - 4}</span>
              )}
            </div>
          )}
        </div>
      </div>

      {lockModal && (
        <LockModal
          mode={lockModal}
          onConfirm={lockModal === 'unlock' ? handleUnlock : (pw) => onLock(memo.id, memo.content, pw)}
          onClose={() => setLockModal(null)}
        />
      )}
      {showFolderPicker && onMoveToFolder && (
        <FolderPickerPopup
          folders={folders}
          currentFolderId={memo.folderId}
          onSelect={(fid) => { onMoveToFolder(memo.id, fid); setShowFolderPicker(false) }}
          onClose={() => setShowFolderPicker(false)}
        />
      )}
    </>
  )
}

function CardMenu({
  memo, isTrash = false, onPin, onStar, onDelete, onRestore, onPermanentDelete, onLockClick, onMoveToFolderClick, open, setOpen,
}: {
  memo: Memo
  isTrash?: boolean
  onPin: (id: string, current: boolean) => void
  onStar: (id: string, current: boolean) => void
  onDelete: (id: string) => void
  onRestore: (id: string) => void
  onPermanentDelete: (id: string) => void
  onLockClick: () => void
  onMoveToFolderClick?: () => void
  open: boolean
  setOpen: (v: boolean) => void
}) {
  const btnRef = useRef<HTMLButtonElement>(null)
  const [menuCoords, setMenuCoords] = useState<{ top?: number; bottom?: number; right: number } | null>(null)

  function handleToggle(e: React.MouseEvent) {
    e.stopPropagation()
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      const MENU_H = 220 // 메뉴 예상 높이(px)
      const right  = window.innerWidth - rect.right + 2
      // 위쪽 공간이 부족하면 버튼 아래로 열기, 아니면 버튼 위로 열기
      if (rect.top < MENU_H) {
        setMenuCoords({ top: rect.bottom + 2, right })
      } else {
        setMenuCoords({ bottom: window.innerHeight - rect.top + 2, right })
      }
    }
    setOpen(!open)
  }

  return (
    <div className="relative">
      <button
        ref={btnRef}
        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 transition-opacity"
        onClick={handleToggle}
      >
        <MoreVertical size={13} />
      </button>
      {open && menuCoords && (
        <>
          <div className="fixed inset-0 z-40" onClick={(e) => { e.stopPropagation(); setOpen(false) }} />
          {/* fixed 포지셔닝 — overflow:hidden 컨테이너에 잘리지 않음 */}
          <div
            className="fixed z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg py-1 w-40"
            style={menuCoords}
          >
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
                {onMoveToFolderClick && (
                  <MenuItem icon={<FolderInput size={13} />} label="폴더 이동" onClick={() => { setOpen(false); onMoveToFolderClick() }} />
                )}
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

import type { Folder as FolderType } from '@/types'

function FolderPickerPopup({ folders, currentFolderId, onSelect, onClose }: {
  folders: FolderType[]
  currentFolderId: string | null
  onSelect: (folderId: string | null) => void
  onClose: () => void
}) {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set())

  function toggleFolderExpand(parentId: string) {
    setExpandedFolders((prev) => {
      const next = new Set(prev)
      if (next.has(parentId)) next.delete(parentId)
      else next.add(parentId)
      return next
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={(e) => { e.stopPropagation(); onClose() }}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl py-2 w-52 max-h-80 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 px-4 pt-1 pb-2">폴더 선택</p>

        {/* 폴더 없음 */}
        <button
          onClick={() => onSelect(null)}
          className={cn(
            'w-full flex items-center gap-2 px-4 py-2 text-sm text-left transition-colors',
            !currentFolderId ? 'text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-950/20' : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800'
          )}
        >
          <Folder size={14} className="flex-shrink-0" />
          <span>폴더 없음</span>
        </button>

        {/* 부모 폴더 + Accordion 서브폴더 */}
        {folders
          .filter((f) => !f.parentId)
          .sort((a, b) => a.orderIndex - b.orderIndex)
          .map((parent) => {
            const children = folders
              .filter((f) => f.parentId === parent.id)
              .sort((a, b) => a.orderIndex - b.orderIndex)
            const hasChildren = children.length > 0
            const isExpanded = expandedFolders.has(parent.id)
            const parentColor = `hsl(${parent.colorH}, ${parent.colorS}%, ${parent.colorL}%)`

            return (
              <div key={parent.id}>
                {/* 부모 폴더 행 */}
                <div className={cn(
                  'w-full flex items-center gap-1 px-2 py-2 text-sm transition-colors',
                  currentFolderId === parent.id
                    ? 'bg-violet-50 dark:bg-violet-950/20 text-violet-600 dark:text-violet-400'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                )}>
                  {/* 펼침/접힘 화살표 — 자식 없으면 invisible */}
                  <button
                    onClick={(e) => { e.stopPropagation(); toggleFolderExpand(parent.id) }}
                    className={cn('flex-shrink-0 p-0.5 transition-transform', !hasChildren && 'invisible')}
                  >
                    <ChevronRight size={12} className={cn('transition-transform', isExpanded && 'rotate-90')} />
                  </button>

                  {/* 폴더명 클릭 → 이동 */}
                  <button
                    onClick={() => onSelect(parent.id)}
                    className="flex items-center gap-2 flex-1 text-left min-w-0"
                  >
                    <Folder size={14} className="hidden sm:inline-block flex-shrink-0" style={{ color: parentColor }} />
                    <span className="sm:hidden w-3 h-3 rounded-full flex-shrink-0" style={{ background: parentColor }} />
                    <span className="truncate">{parent.name}</span>
                  </button>
                </div>

                {/* 서브폴더 */}
                {isExpanded && children.map((child) => {
                  const childColor = `hsl(${child.colorH}, ${child.colorS}%, ${child.colorL}%)`
                  return (
                    <button
                      key={child.id}
                      onClick={() => onSelect(child.id)}
                      className={cn(
                        'w-full flex items-center gap-2 pl-9 pr-3 py-2 text-sm text-left transition-colors',
                        currentFolderId === child.id
                          ? 'bg-violet-50 dark:bg-violet-950/20 text-violet-600 dark:text-violet-400'
                          : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                      )}
                    >
                      <Folder size={14} className="hidden sm:inline-block flex-shrink-0" style={{ color: childColor }} />
                      <span className="sm:hidden w-3 h-3 rounded-full flex-shrink-0" style={{ background: childColor }} />
                      <span className="truncate">{child.name}</span>
                    </button>
                  )
                })}
              </div>
            )
          })}
      </div>
    </div>
  )
}
