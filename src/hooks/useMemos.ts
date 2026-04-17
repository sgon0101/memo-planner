'use client'

import { useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useMemoStore } from '@/store/memoStore'
import { encryptContent, decryptContent } from '@/lib/crypto/lock'
import type { Memo } from '@/types'

const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] }

export function toMemo(row: Record<string, unknown>): Memo {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    folderId: (row.folder_id as string) ?? null,
    title: (row.title as string) ?? '',
    content: (row.content as Record<string, unknown>) ?? {},
    contentText: (row.content_text as string) ?? '',
    isPinned: (row.is_pinned as boolean) ?? false,
    isStarred: (row.is_starred as boolean) ?? false,
    isLocked: (row.is_locked as boolean) ?? false,
    lockedContent: (row.locked_content as string) ?? null,
    isDeleted: (row.is_deleted as boolean) ?? false,
    deletedAt: (row.deleted_at as string) ?? null,
    tags: (row.tags as string[]) ?? [],
    linkedPlanIds: (row.linked_plan_ids as string[]) ?? [],
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }
}

export const TRASH_ID = '__trash__'

export function useMemos(folderId: string | null | undefined) {
  const { memos, setMemos, addMemo, updateMemo, deleteMemo } = useMemoStore()
  const supabase = createClient()
  const isTrash = folderId === TRASH_ID

  const load = useCallback(async () => {
    if (isTrash) {
      const { data } = await supabase
        .from('memos')
        .select('*')
        .eq('is_deleted', true)
        .order('deleted_at', { ascending: false })
      if (data) setMemos(data.map(toMemo))
      return
    }

    let query = supabase
      .from('memos')
      .select('*')
      .eq('is_deleted', false)
      .order('is_pinned', { ascending: false })
      .order('updated_at', { ascending: false })

    if (folderId !== undefined) {
      query = folderId === null
        ? query
        : query.eq('folder_id', folderId)
    }

    const { data } = await query
    if (data) setMemos(data.map(toMemo))
  }, [folderId, isTrash])

  useEffect(() => { load() }, [load])

  const createMemo = useCallback(async () => {
    const { data, error } = await supabase
      .from('memos')
      .insert({
        title: '',
        content: EMPTY_DOC,
        content_text: '',
        folder_id: folderId ?? null,
      })
      .select()
      .single()
    if (error) throw error
    const memo = toMemo(data)
    addMemo(memo)
    return memo
  }, [folderId])

  const togglePin = useCallback(async (id: string, current: boolean) => {
    await supabase.from('memos').update({ is_pinned: !current }).eq('id', id)
    updateMemo(id, { isPinned: !current })
  }, [])

  const toggleStar = useCallback(async (id: string, current: boolean) => {
    await supabase.from('memos').update({ is_starred: !current }).eq('id', id)
    updateMemo(id, { isStarred: !current })
  }, [])

  const softDelete = useCallback(async (id: string) => {
    await supabase
      .from('memos')
      .update({ is_deleted: true, deleted_at: new Date().toISOString() })
      .eq('id', id)
    deleteMemo(id)
  }, [])

  const lockMemo = useCallback(async (
    id: string,
    content: Record<string, unknown>,
    password: string
  ) => {
    const encrypted = await encryptContent(JSON.stringify(content), password)
    await supabase.from('memos').update({
      is_locked: true,
      locked_content: encrypted,
      content: null,
      content_text: '',
    }).eq('id', id)
    updateMemo(id, { isLocked: true, lockedContent: encrypted, content: {}, contentText: '' })
  }, [])

  const unlockMemo = useCallback(async (
    id: string,
    lockedContent: string,
    password: string
  ) => {
    const plaintext = await decryptContent(lockedContent, password)
    const content = JSON.parse(plaintext) as Record<string, unknown>
    await supabase.from('memos').update({
      is_locked: false,
      locked_content: null,
      content,
    }).eq('id', id)
    updateMemo(id, { isLocked: false, lockedContent: null, content })
  }, [])

  const restoreMemo = useCallback(async (id: string) => {
    await supabase.from('memos').update({ is_deleted: false, deleted_at: null }).eq('id', id)
    deleteMemo(id)
  }, [])

  const permanentDelete = useCallback(async (id: string) => {
    await supabase.from('memos').delete().eq('id', id)
    deleteMemo(id)
  }, [])

  const emptyTrash = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    await supabase.from('memos').delete().eq('user_id', user.id).eq('is_deleted', true)
    setMemos([])
  }, [])

  return {
    memos, isTrash,
    createMemo, togglePin, toggleStar, softDelete,
    lockMemo, unlockMemo,
    restoreMemo, permanentDelete, emptyTrash,
    refresh: load,
  }
}
