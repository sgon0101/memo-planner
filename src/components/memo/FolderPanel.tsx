'use client'

import { useState, useRef } from 'react'
import { Plus, Folder, FolderOpen, MoreHorizontal, Pencil, Palette, Trash2, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useFolders } from '@/hooks/useFolders'
import { useFolderStore } from '@/store/folderStore'
import { TRASH_ID } from '@/hooks/useMemos'
import ColorWheelModal from './ColorWheelModal'
import type { Folder as FolderType } from '@/types'

interface MenuState {
  folderId: string
  x: number
  y: number
}

export default function FolderPanel() {
  const { folders, createFolder, renameFolder, updateColor, removeFolder } = useFolders()
  const { selectedFolderId, selectFolder } = useFolderStore()

  const [menu, setMenu] = useState<MenuState | null>(null)
  const [colorTarget, setColorTarget] = useState<FolderType | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const editRef = useRef<HTMLInputElement>(null)

  const topLevel = folders.filter((f) => f.parentId === null).sort((a, b) => a.orderIndex - b.orderIndex)

  function openMenu(e: React.MouseEvent, folderId: string) {
    e.stopPropagation()
    setMenu({ folderId, x: e.clientX, y: e.clientY })
  }

  function startEdit(folder: FolderType) {
    setEditingId(folder.id)
    setEditValue(folder.name)
    setMenu(null)
    setTimeout(() => editRef.current?.focus(), 50)
  }

  async function commitEdit(id: string) {
    if (editValue.trim() && editValue !== folders.find((f) => f.id === id)?.name) {
      await renameFolder(id, editValue.trim()).catch(console.error)
    }
    setEditingId(null)
  }

  async function handleAddFolder(parentId: string | null = null) {
    try {
      const folder = await createFolder('새 폴더', parentId)
      startEdit(folder)
      if (parentId) setExpanded((prev) => new Set([...prev, parentId]))
    } catch (e) {
      console.error(e)
    }
  }

  async function handleDelete(id: string) {
    setMenu(null)
    if (!confirm('폴더를 삭제하면 안의 메모는 미분류로 이동됩니다. 삭제할까요?')) return
    await removeFolder(id).catch(console.error)
    if (selectedFolderId === id) selectFolder(null)
  }

  function FolderItem({ folder, depth = 0 }: { folder: FolderType; depth?: number }) {
    const isSelected = selectedFolderId === folder.id
    const isExpanded = expanded.has(folder.id)
    const children = folders.filter((f) => f.parentId === folder.id).sort((a, b) => a.orderIndex - b.orderIndex)
    const hasChildren = children.length > 0
    const folderColor = `hsl(${folder.colorH}, ${folder.colorS}%, ${folder.colorL}%)`

    return (
      <div>
        <div
          className={cn(
            'group flex items-center gap-1.5 px-2 py-1.5 rounded-lg cursor-pointer select-none text-sm transition-colors',
            isSelected
              ? 'bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300'
              : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
          )}
          style={{ paddingLeft: `${8 + depth * 16}px` }}
          onClick={() => selectFolder(isSelected ? null : folder.id)}
        >
          {/* 확장 토글 */}
          <button
            className={cn('flex-shrink-0 transition-transform', !hasChildren && 'invisible')}
            onClick={(e) => {
              e.stopPropagation()
              setExpanded((prev) => {
                const next = new Set(prev)
                next.has(folder.id) ? next.delete(folder.id) : next.add(folder.id)
                return next
              })
            }}
          >
            <ChevronRight size={12} className={cn('transition-transform', isExpanded && 'rotate-90')} />
          </button>

          {/* 폴더 아이콘 */}
          {isExpanded || isSelected ? (
            <FolderOpen size={15} className="flex-shrink-0" style={{ color: folderColor }} />
          ) : (
            <Folder size={15} className="flex-shrink-0" style={{ color: folderColor }} />
          )}

          {/* 이름 (편집 모드) */}
          {editingId === folder.id ? (
            <input
              ref={editRef}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={() => commitEdit(folder.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitEdit(folder.id)
                if (e.key === 'Escape') setEditingId(null)
              }}
              className="flex-1 bg-transparent outline-none text-sm min-w-0"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="flex-1 truncate text-sm">{folder.name}</span>
          )}

          {/* 컨텍스트 메뉴 버튼 */}
          {editingId !== folder.id && (
            <button
              className="opacity-0 group-hover:opacity-100 flex-shrink-0 p-0.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-opacity"
              onClick={(e) => openMenu(e, folder.id)}
            >
              <MoreHorizontal size={14} />
            </button>
          )}
        </div>

        {/* 서브폴더 */}
        {isExpanded && children.map((child) => (
          <FolderItem key={child.id} folder={child} depth={depth + 1} />
        ))}
      </div>
    )
  }

  const menuFolder = menu ? folders.find((f) => f.id === menu.folderId) : null

  return (
    <div className="flex flex-col h-full">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 dark:border-gray-800">
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">폴더</span>
        <button
          onClick={() => handleAddFolder(null)}
          className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
          title="폴더 추가"
        >
          <Plus size={15} />
        </button>
      </div>

      {/* 전체 메모 */}
      <div
        className={cn(
          'flex items-center gap-2 px-3 py-2 cursor-pointer text-sm transition-colors',
          selectedFolderId === null
            ? 'bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300'
            : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
        )}
        onClick={() => selectFolder(null)}
      >
        <Folder size={15} />
        <span>전체 메모</span>
      </div>

      {/* 폴더 목록 */}
      <div className="flex-1 overflow-y-auto px-1 py-1 space-y-0.5">
        {topLevel.map((folder) => (
          <FolderItem key={folder.id} folder={folder} />
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
              onClick={() => { startEdit(menuFolder) }}
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
              onClick={() => handleAddFolder(menuFolder.id)}
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
    </div>
  )
}
