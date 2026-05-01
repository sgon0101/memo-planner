'use client'

import { useEffect, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useFolderStore } from '@/store/folderStore'
import type { Folder } from '@/types'

function toFolder(row: Record<string, unknown>): Folder {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    name: row.name as string,
    colorH: row.color_h as number,
    colorS: row.color_s as number,
    colorL: row.color_l as number,
    parentId: (row.parent_id as string) ?? null,
    orderIndex: row.order_index as number,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }
}

export const folderKeys = {
  all: () => ['folders'] as const,
}

export function useFolders() {
  const { folders, setFolders, addFolder, updateFolder, deleteFolder } = useFolderStore()
  const supabase = createClient()
  const queryClient = useQueryClient()

  const { data } = useQuery({
    queryKey: folderKeys.all(),
    queryFn: async () => {
      const { data } = await supabase
        .from('folders')
        .select('*')
        .order('order_index', { ascending: true })
      return (data ?? []).map(toFolder)
    },
  })

  // React Query 캐시 → Zustand 동기화 (다른 컴포넌트 호환)
  useEffect(() => {
    if (data) setFolders(data)
  }, [data, setFolders])

  const createFolder = useCallback(async (name: string, parentId: string | null = null) => {
    const { data: { user } } = await supabase.auth.getUser()
    const maxOrder = folders.filter((f) => f.parentId === parentId).length
    const { data, error } = await supabase
      .from('folders')
      .insert({ user_id: user?.id, name, parent_id: parentId, order_index: maxOrder, color_h: 260, color_s: 60, color_l: 80 })
      .select()
      .single()
    if (error) throw error
    const folder = toFolder(data)
    addFolder(folder)
    queryClient.setQueryData<Folder[]>(folderKeys.all(), (old) => [...(old ?? []), folder])
    return folder
  }, [folders, queryClient, supabase, addFolder])

  const renameFolder = useCallback(async (id: string, name: string) => {
    const { error } = await supabase.from('folders').update({ name }).eq('id', id)
    if (error) throw error
    updateFolder(id, { name })
    queryClient.setQueryData<Folder[]>(folderKeys.all(), (old) =>
      old?.map((f) => f.id === id ? { ...f, name } : f)
    )
  }, [queryClient, supabase, updateFolder])

  const updateColor = useCallback(async (id: string, colorH: number, colorS: number, colorL: number) => {
    const { error } = await supabase
      .from('folders')
      .update({ color_h: colorH, color_s: colorS, color_l: colorL })
      .eq('id', id)
    if (error) throw error
    updateFolder(id, { colorH, colorS, colorL })
    queryClient.setQueryData<Folder[]>(folderKeys.all(), (old) =>
      old?.map((f) => f.id === id ? { ...f, colorH, colorS, colorL } : f)
    )
  }, [queryClient, supabase, updateFolder])

  const reorderFolder = useCallback(async (
    dragId: string,
    targetId: string,
    position: 'before' | 'after',
  ) => {
    const dragFolder = folders.find((f) => f.id === dragId)
    if (!dragFolder) return

    const siblings = folders
      .filter((f) => f.parentId === dragFolder.parentId)
      .sort((a, b) => a.orderIndex - b.orderIndex)

    const withoutDrag = siblings.filter((f) => f.id !== dragId)
    const targetIdx   = withoutDrag.findIndex((f) => f.id === targetId)
    if (targetIdx === -1) return

    const insertIdx = position === 'before' ? targetIdx : targetIdx + 1
    const reordered = [
      ...withoutDrag.slice(0, insertIdx),
      dragFolder,
      ...withoutDrag.slice(insertIdx),
    ]

    reordered.forEach((f, i) => updateFolder(f.id, { orderIndex: i }))
    queryClient.setQueryData<Folder[]>(folderKeys.all(), (old) => {
      if (!old) return old
      const orderMap = new Map(reordered.map((f, i) => [f.id, i]))
      return old.map((f) => orderMap.has(f.id) ? { ...f, orderIndex: orderMap.get(f.id)! } : f)
    })

    await Promise.all(
      reordered.map((f, i) =>
        supabase.from('folders').update({ order_index: i }).eq('id', f.id)
      )
    )
  }, [folders, queryClient, supabase, updateFolder])

  const nestFolder = useCallback(async (dragId: string, targetId: string) => {
    if (dragId === targetId) return

    const dragFolder = folders.find((f) => f.id === dragId)
    if (!dragFolder) return
    if (dragFolder.parentId === targetId) return

    const getDescendantIds = (id: string): string[] => {
      const children = folders.filter((f) => f.parentId === id)
      return [...children.map((c) => c.id), ...children.flatMap((c) => getDescendantIds(c.id))]
    }
    if (getDescendantIds(dragId).includes(targetId)) return

    const childCount = folders.filter((f) => f.parentId === targetId).length
    updateFolder(dragId, { parentId: targetId, orderIndex: childCount })
    queryClient.setQueryData<Folder[]>(folderKeys.all(), (old) =>
      old?.map((f) => f.id === dragId ? { ...f, parentId: targetId, orderIndex: childCount } : f)
    )

    await supabase
      .from('folders')
      .update({ parent_id: targetId, order_index: childCount })
      .eq('id', dragId)
  }, [folders, queryClient, supabase, updateFolder])

  const removeFolder = useCallback(async (id: string) => {
    const { data: { user } } = await supabase.auth.getUser()
    await supabase
      .from('memos')
      .update({ is_deleted: true, deleted_at: new Date().toISOString(), folder_id: null })
      .eq('folder_id', id)
      .eq('user_id', user?.id)
    const { error } = await supabase.from('folders').delete().eq('id', id)
    if (error) throw error
    deleteFolder(id)
    queryClient.setQueryData<Folder[]>(folderKeys.all(), (old) => old?.filter((f) => f.id !== id))
  }, [queryClient, supabase, deleteFolder])

  return { folders, createFolder, renameFolder, updateColor, removeFolder, reorderFolder, nestFolder }
}
