'use client'

import { useEffect, useCallback } from 'react'
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

export function useFolders() {
  const { folders, setFolders, addFolder, updateFolder, deleteFolder } = useFolderStore()
  const supabase = createClient()

  useEffect(() => {
    async function load() {
      const { data } = await supabase
        .from('folders')
        .select('*')
        .order('order_index', { ascending: true })
      if (data) setFolders(data.map(toFolder))
    }
    load()
  }, [])

  const createFolder = useCallback(async (name: string, parentId: string | null = null) => {
    const { data: { user } } = await supabase.auth.getUser()
    const maxOrder = folders.filter((f) => f.parentId === parentId).length
    const { data, error } = await supabase
      .from('folders')
      .insert({ user_id: user?.id, name, parent_id: parentId, order_index: maxOrder, color_h: 260, color_s: 60, color_l: 80 })
      .select()
      .single()
    if (error) throw error
    addFolder(toFolder(data))
    return toFolder(data)
  }, [folders])

  const renameFolder = useCallback(async (id: string, name: string) => {
    const { error } = await supabase.from('folders').update({ name }).eq('id', id)
    if (error) throw error
    updateFolder(id, { name })
  }, [])

  const updateColor = useCallback(async (id: string, colorH: number, colorS: number, colorL: number) => {
    const { error } = await supabase
      .from('folders')
      .update({ color_h: colorH, color_s: colorS, color_l: colorL })
      .eq('id', id)
    if (error) throw error
    updateFolder(id, { colorH, colorS, colorL })
  }, [])

  const removeFolder = useCallback(async (id: string) => {
    const { error } = await supabase.from('folders').delete().eq('id', id)
    if (error) throw error
    deleteFolder(id)
  }, [])

  return { folders, createFolder, renameFolder, updateColor, removeFolder }
}
