'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Plus, Folder, FolderOpen, MoreHorizontal, Pencil, Palette, Trash2, ChevronRight, Star } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useFolders } from '@/hooks/useFolders'
import { useFolderStore } from '@/store/folderStore'
import { useMemoStore } from '@/store/memoStore'
import { useDragStore } from '@/store/dragStore'
import { createClient } from '@/lib/supabase/client'
import { TRASH_ID } from '@/hooks/useMemos'
import ColorWheelModal from './ColorWheelModal'
import type { Folder as FolderType } from '@/types'

interface MenuState { folderId: string; x: number; y: number }

interface FolderItemProps {
  folder: FolderType
  depth: number
  allFolders: FolderType[]
  expanded: Set<string>
  selectedFolderId: string | null
  editingId: string | null
  editValue: string
  editInputRef: React.RefObject<HTMLInputElement | null>
  dragOverFolderId: string | null
  onSelect: (id: string) => void
  onToggleExpand: (id: string) => void
  onOpenMenu: (e: React.MouseEvent, id: string) => void
  onEditValueChange: (value: string) => void
  onCommitEdit: (id: string) => void
  onCancelEdit: () => void
}

function FolderItem({
  folder, depth, allFolders, expanded, selectedFolderId,
  editingId, editValue, editInputRef, dragOverFolderId,
  onSelect, onToggleExpand, onOpenMenu,
  onEditValueChange, onCommitEdit, onCancelEdit,
}: FolderItemProps) {
  const isSelected = selectedFolderId === folder.id
  const isExpanded = expanded.has(folder.id)
  const isEditing = editingId === folder.id
  const isDragOver = dragOverFolderId === folder.id
  const children = allFolders
    .filter((f) => f.parentId === folder.id)
    .sort((a, b) => a.orderIndex - b.orderIndex)
  const hasChildren = children.length > 0
  const folderColor = `hsl(${folder.colorH}, ${folder.colorS}%, ${folder.colorL}%)`

  return (
    <div>
      <div
        data-folder-id={folder.id}
        className={cn(
          'group flex items-center gap-1.5 rounded-lg cursor-pointer select-none text-sm transition-colors py-1.5 pr-2',
          isDragOver
            ? 'ring-2 ring-violet-400 bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-300'
            : isSelected
              ? 'bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300'
              : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
        )}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        onClick={() => onSelect(folder.id)}
      >
        <button
          className={cn('flex-shrink-0 transition-transform', !hasChildren && 'invisible')}
          onClick={(e) => { e.stopPropagation(); onToggleExpand(folder.id) }}
        >
          <ChevronRight size={12} className={cn('transition-transform', isExpanded && 'rotate-90')} />
        </button>

        {isExpanded || isSelected ? (
          <FolderOpen size={15} className="flex-shrink-0" style={{ color: folderColor }} />
        ) : (
          <Folder size={15} className="flex-shrink-0" style={{ color: folderColor }} />
        )}

        {isEditing ? (
          <input
            ref={editInputRef}
            value={editValue}
            onChange={(e) => onEditValueChange(e.target.value)}
            onBlur={() => onCommitEdit(folder.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); onCommitEdit(folder.id) }
              if (e.key === 'Escape') { e.preventDefault(); onCancelEdit() }
            }}
            className="flex-1 bg-transparent outline-none text-sm min-w-0 border-b border-violet-400 dark:border-violet-500"
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="flex-1 truncate text-sm">{folder.name}</span>
        )}

        {!isEditing && (
          <button
            className="opacity-0 group-hover:opacity-100 flex-shrink-0 p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-opacity"
            onClick={(e) => onOpenMenu(e, folder.id)}
          >
            <MoreHorizontal size={14} />
          </button>
        )}
      </div>

      {isExpanded && children.map((child) => (
        <FolderItem
          key={child.id}
          folder={child}
          depth={depth + 1}
          allFolders={allFolders}
          expanded={expanded}
          selectedFolderId={selectedFolderId}
          editingId={editingId}
          editValue={editValue}
          editInputRef={editInputRef}
          dragOverFolderId={dragOverFolderId}
          onSelect={onSelect}
          onToggleExpand={onToggleExpand}
          onOpenMenu={onOpenMenu}
          onEditValueChange={onEditValueChange}
          onCommitEdit={onCommitEdit}
          onCancelEdit={onCancelEdit}
        />
      ))}
    </div>
  )
}

export default function FolderPanel() {
  const { folders, createFolder, renameFolder, updateColor, removeFolder } = useFolders()
  const { selectedFolderId, selectFolder } = useFolderStore()
  const { updateMemo } = useMemoStore()
  const { draggingMemoId } = useDragStore()

  const [menu, setMenu] = useState<MenuState | null>(null)
  const [colorTarget, setColorTarget] = useState<FolderType | null>(null)
  const [showNewFolderModal, setShowNewFolderModal] = useState(false)
  const [newFolderParentId, setNewFolderParentId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const editInputRef = useRef<HTMLInputElement | null>(null)

  const topLevel = folders
    .filter((f) => f.parentId === null)
    .sort((a, b) => a.orderIndex - b.orderIndex)

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2500)
  }

  const handleDrop = useCallback(async (memoId: string, folderId: string | null) => {
    setDragOverFolderId(null)
    if (!memoId) return
    const supabase = createClient()

    if (folderId === '__starred__') {
      await supabase.from('memos').update({ is_starred: true }).eq('id', memoId)
      updateMemo(memoId, { isStarred: true })
      showToast('메모가 중요로 표시됐어요')
      return
    }

    const resolvedFolderId = folderId === '__all__' ? null : folderId
    await supabase.from('memos').update({ folder_id: resolvedFolderId }).eq('id', memoId)
    updateMemo(memoId, { folderId: resolvedFolderId })
    const folderName = resolvedFolderId
      ? folders.find((f) => f.id === resolvedFolderId)?.name ?? '폴더'
      : '전체 메모'
    showToast(`메모가 ${folderName}으로 이동됐어요`)
  }, [folders, updateMemo])

  // 터치 드래그 커스텀 이벤트 수신
  useEffect(() => {
    function onTouchDrop(e: Event) {
      const { memoId, folderId } = (e as CustomEvent<{ memoId: string; folderId: string | null }>).detail
      void handleDrop(memoId, folderId)
    }
    window.addEventListener('memo-folder-drop', onTouchDrop)
    return () => window.removeEventListener('memo-folder-drop', onTouchDrop)
  }, [handleDrop])

  function openMenu(e: React.MouseEvent, folderId: string) {
    e.stopPropagation()
    setMenu({ folderId, x: e.clientX, y: e.clientY })
  }

  function startEdit(folderId: string, currentName: string) {
    setEditingId(folderId)
    setEditValue(currentName)
    setMenu(null)
    setTimeout(() => editInputRef.current?.focus(), 50)
  }

  async function commitEdit(id: string) {
    const original = folders.find((f) => f.id === id)?.name ?? ''
    if (editValue.trim() && editValue.trim() !== original) {
      await renameFolder(id, editValue.trim()).catch(console.error)
    }
    setEditingId(null)
  }

  function cancelEdit() { setEditingId(null) }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function handleSelect(id: string) {
    selectFolder(selectedFolderId === id ? null : id)
  }

  async function handleNewFolderConfirm(h: number, s: number, l: number, name?: string) {
    setShowNewFolderModal(false)
    if (!name?.trim()) return
    try {
      const folder = await createFolder(name.trim(), newFolderParentId)
      if (h !== 260 || s !== 60 || l !== 80) {
        await updateColor(folder.id, h, s, l).catch(console.error)
      }
      if (newFolderParentId) {
        setExpanded((prev) => new Set([...prev, newFolderParentId as string]))
      }
    } catch (e) { console.error(e) }
  }

  async function handleDelete(id: string) {
    setMenu(null)
    if (!confirm('폴더를 삭제하면 안의 메모는 미분류로 이동됩니다. 삭제할까요?')) return
    await removeFolder(id).catch(console.error)
    if (selectedFolderId === id) selectFolder(null)
  }

  const menuFolder = menu ? folders.find((f) => f.id === menu.folderId) : null

  // 드래그 이벤트 위임 핸들러
  function onPanelDragOver(e: React.DragEvent) {
    if (!draggingMemoId) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const folderEl = (e.target as HTMLElement).closest('[data-folder-id]') as HTMLElement | null
    const id = folderEl?.getAttribute('data-folder-id') ?? null
    if (id !== dragOverFolderId) setDragOverFolderId(id)
  }

  function onPanelDrop(e: React.DragEvent) {
    e.preventDefault()
    const memoId = e.dataTransfer.getData('memoId')
    if (!memoId) return
    const folderEl = (e.target as HTMLElement).closest('[data-folder-id]') as HTMLElement | null
    const folderId = folderEl?.getAttribute('data-folder-id') ?? null
    if (folderId) void handleDrop(memoId, folderId)
    else setDragOverFolderId(null)
  }

  function onPanelDragLeave(e: React.DragEvent) {
    if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
      setDragOverFolderId(null)
    }
  }

  return (
    <div
      className="flex flex-col h-full"
      onDragOver={onPanelDragOver}
      onDrop={onPanelDrop}
      onDragLeave={onPanelDragLeave}
    >
      {/* 헤더 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-800">
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">폴더</span>
        <button
          onClick={() => { setNewFolderParentId(null); setShowNewFolderModal(true) }}
          className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
          title="폴더 추가"
        >
          <Plus size={15} />
        </button>
      </div>

      {/* 전체 메모 */}
      <div
        data-folder-id="__all__"
        className={cn(
          'flex items-center gap-2 px-3 py-2 cursor-pointer text-sm transition-colors',
          dragOverFolderId === '__all__'
            ? 'ring-2 ring-violet-400 bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-300'
            : selectedFolderId === null
              ? 'bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300'
              : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
        )}
        onClick={() => selectFolder(null)}
      >
        <Folder size={15} />
        <span>전체 메모</span>
      </div>

      {/* ★ 중요 드랍존 (드래그 중일 때만 표시) */}
      {draggingMemoId && (
        <div
          data-folder-id="__starred__"
          className={cn(
            'flex items-center gap-2 px-3 py-2 text-sm cursor-default transition-colors border-b border-dashed border-amber-200 dark:border-amber-800',
            dragOverFolderId === '__starred__'
              ? 'bg-amber-50 dark:bg-amber-950/20 text-amber-600 ring-1 ring-amber-400'
              : 'text-amber-500 dark:text-amber-400 bg-amber-50/50 dark:bg-amber-950/10'
          )}
        >
          <Star size={14} className="fill-amber-400 text-amber-400 flex-shrink-0" />
          <span>중요로 표시</span>
        </div>
      )}

      {/* 폴더 목록 */}
      <div className="flex-1 overflow-y-auto px-1 py-1 space-y-0.5">
        {topLevel.map((folder) => (
          <FolderItem
            key={folder.id}
            folder={folder}
            depth={0}
            allFolders={folders}
            expanded={expanded}
            selectedFolderId={selectedFolderId}
            editingId={editingId}
            editValue={editValue}
            editInputRef={editInputRef}
            dragOverFolderId={dragOverFolderId}
            onSelect={handleSelect}
            onToggleExpand={toggleExpand}
            onOpenMenu={openMenu}
            onEditValueChange={setEditValue}
            onCommitEdit={commitEdit}
            onCancelEdit={cancelEdit}
          />
        ))}
      </div>

      {/* 컨텍스트 메뉴 */}
      {menu && menuFolder && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setMenu(null)} />
          <div
            className="fixed z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg py-1 w-40"
            style={{ left: menu.x, top: menu.y }}
          >
            <button
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              onClick={() => startEdit(menuFolder.id, menuFolder.name)}
            >
              <Pencil size={14} /> 이름 변경
            </button>
            <button
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              onClick={() => { setColorTarget(menuFolder); setMenu(null) }}
            >
              <Palette size={14} /> 색상 변경
            </button>
            <button
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              onClick={() => { setNewFolderParentId(menuFolder.id); setMenu(null); setShowNewFolderModal(true) }}
            >
              <Plus size={14} /> 하위 폴더
            </button>
            <hr className="my-1 border-gray-200 dark:border-gray-700" />
            <button
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
              onClick={() => handleDelete(menuFolder.id)}
            >
              <Trash2 size={14} /> 삭제
            </button>
          </div>
        </>
      )}

      {/* 휴지통 */}
      <div
        className={cn(
          'flex items-center gap-2 px-3 py-2 cursor-pointer text-sm border-t border-gray-100 dark:border-gray-800 transition-colors',
          selectedFolderId === TRASH_ID
            ? 'bg-red-50 dark:bg-red-950/20 text-red-500 dark:text-red-400'
            : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
        )}
        onClick={() => selectFolder(TRASH_ID)}
      >
        <Trash2 size={14} />
        <span>휴지통</span>
      </div>

      {/* 새 폴더 생성 모달 */}
      {showNewFolderModal && (
        <ColorWheelModal
          showNameInput
          initialName=""
          onConfirm={handleNewFolderConfirm}
          onClose={() => setShowNewFolderModal(false)}
        />
      )}

      {/* 색상 변경 모달 */}
      {colorTarget && (
        <ColorWheelModal
          initialH={colorTarget.colorH}
          initialS={colorTarget.colorS}
          initialL={colorTarget.colorL}
          onConfirm={(h, s, l) => {
            updateColor(colorTarget.id, h, s, l).catch(console.error)
            setColorTarget(null)
          }}
          onClose={() => setColorTarget(null)}
        />
      )}

      {/* 드랍 성공 토스트 */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] bg-gray-900 text-white text-xs px-4 py-2.5 rounded-full shadow-lg animate-fade-in">
          {toast}
        </div>
      )}
    </div>
  )
}
