'use client'

import { useCallback, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useMemoStore } from '@/store/memoStore'
import { encryptContent, decryptContent } from '@/lib/crypto/lock'
import type { Memo } from '@/types'

const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] }

// content, locked_content 제외 — 목록 페이로드 경량화
const LIST_COLS =
  'id, user_id, title, content_text, folder_id, is_pinned, is_starred, is_locked, is_deleted, deleted_at, tags, wiki_links, linked_plan_ids, created_at, updated_at'

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
    wikiLinks: (row.wiki_links as string[]) ?? [],
    linkedPlanIds: (row.linked_plan_ids as string[]) ?? [],
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }
}

export const TRASH_ID = '__trash__'

export const memoKeys = {
  list: (folderId: string | null | undefined, isTrash: boolean) =>
    ['memos', folderId ?? 'all', isTrash] as const,
}

export function useMemos(folderId: string | null | undefined) {
  const { memos, setMemos, appendMemos, addMemo, updateMemo, deleteMemo } = useMemoStore()
  const supabase = createClient()
  const queryClient = useQueryClient()
  const isTrash = folderId === TRASH_ID

  const fetchMemos = useCallback(async (): Promise<Memo[]> => {
    if (isTrash) {
      const { data } = await supabase
        .from('memos')
        .select(LIST_COLS)
        .eq('is_deleted', true)
        .order('deleted_at', { ascending: false })
      const result = (data ?? []).map(toMemo)
      setMemos(result)
      return result
    }

    let query = supabase
      .from('memos')
      .select(LIST_COLS)
      .eq('is_deleted', false)
      .order('is_pinned', { ascending: false })
      .order('updated_at', { ascending: false })

    if (folderId !== undefined) {
      if (folderId !== null) query = query.eq('folder_id', folderId)
    }

    const { data } = await query
    const result = (data ?? []).map(toMemo)
    setMemos(result)
    return result
  }, [folderId, isTrash])

  const { isLoading, data } = useQuery({
    queryKey: memoKeys.list(folderId, isTrash),
    queryFn: fetchMemos,
    staleTime: 30_000,
  })

  // 캐시 히트 시에도 Zustand 동기화 (폴더 전환 시 stale data 방지)
  useEffect(() => {
    if (data) setMemos(data)
  }, [data])

  // Zustand 낙관적 업데이트 후 React Query 캐시 무효화
  const optimisticPatch = useCallback(
    async (id: string, patch: Partial<Memo>, dbPatch: Record<string, unknown>) => {
      updateMemo(id, patch)
      const { error } = await supabase.from('memos').update(dbPatch).eq('id', id)
      if (error) {
        // 롤백 — 반전 패치
        const rollback = Object.fromEntries(
          Object.entries(patch).map(([k]) => [k, memos.find((m) => m.id === id)?.[k as keyof Memo]])
        ) as Partial<Memo>
        updateMemo(id, rollback)
        throw error
      }
      queryClient.invalidateQueries({ queryKey: memoKeys.list(folderId, isTrash) })
    },
    [memos, folderId, isTrash]
  )

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
    queryClient.invalidateQueries({ queryKey: memoKeys.list(folderId, isTrash) })
    return memo
  }, [folderId, isTrash])

  const togglePin = useCallback(
    (id: string, current: boolean) =>
      optimisticPatch(id, { isPinned: !current }, { is_pinned: !current }),
    [optimisticPatch]
  )

  const toggleStar = useCallback(
    (id: string, current: boolean) =>
      optimisticPatch(id, { isStarred: !current }, { is_starred: !current }),
    [optimisticPatch]
  )

  const softDelete = useCallback(async (id: string) => {
    await supabase
      .from('memos')
      .update({ is_deleted: true, deleted_at: new Date().toISOString() })
      .eq('id', id)
    deleteMemo(id)
    queryClient.invalidateQueries({ queryKey: memoKeys.list(folderId, isTrash) })
  }, [folderId, isTrash])

  const lockMemo = useCallback(async (
    id: string,
    content: Record<string, unknown>,
    password: string
  ) => {
    // 목록에서 잠금 시 content가 {} 일 수 있으므로 서버에서 가져옴
    let targetContent = content
    if (!content || Object.keys(content).length === 0) {
      const { data } = await supabase
        .from('memos')
        .select('content')
        .eq('id', id)
        .single()
      if (data?.content) targetContent = data.content as Record<string, unknown>
    }
    const encrypted = await encryptContent(JSON.stringify(targetContent), password)
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
    queryClient.invalidateQueries({ queryKey: memoKeys.list(null, false) })
  }, [])

  const permanentDelete = useCallback(async (id: string) => {
    await supabase.from('memos').delete().eq('id', id)
    deleteMemo(id)
  }, [])

  const moveMemoToFolder = useCallback(async (id: string, targetFolderId: string | null) => {
    await supabase.from('memos').update({ folder_id: targetFolderId }).eq('id', id)
    updateMemo(id, { folderId: targetFolderId })
    queryClient.invalidateQueries({ queryKey: ['memos'] })
  }, [])

  const emptyTrash = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    await supabase.from('memos').delete().eq('user_id', user.id).eq('is_deleted', true)
    setMemos([])
    queryClient.invalidateQueries({ queryKey: memoKeys.list(TRASH_ID, true) })
  }, [])

  return {
    memos,
    isLoading,
    isTrash,
    createMemo,
    togglePin,
    toggleStar,
    softDelete,
    lockMemo,
    unlockMemo,
    restoreMemo,
    permanentDelete,
    emptyTrash,
    moveMemoToFolder,
    refresh: fetchMemos,
  }
}
