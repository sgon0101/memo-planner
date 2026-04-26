'use client'

import { useCallback, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useMemoStore } from '@/store/memoStore'
import { encryptContent, decryptContent } from '@/lib/crypto/lock'
import type { Memo } from '@/types'

const EMPTY_DOC = { type: 'doc', content: [{ type: 'paragraph' }] }

const LIST_COLS =
  'id, user_id, title, content, content_text, folder_id, is_pinned, is_starred, is_locked, is_deleted, deleted_at, tags, wiki_links, linked_plan_ids, created_at, updated_at'

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
  const { setMemos, addMemo, updateMemo, deleteMemo } = useMemoStore()
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
      return (data ?? []).map(toMemo)
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
    return (data ?? []).map(toMemo)
  }, [folderId, isTrash])

  const { isLoading, data } = useQuery({
    queryKey: memoKeys.list(folderId, isTrash),
    queryFn: fetchMemos,
    staleTime: 30_000,
  })

  // Zustand를 보조 상태로 동기화 (MemoEditor 등 다른 컴포넌트 호환)
  useEffect(() => {
    if (data) setMemos(data)
  }, [data])

  // ── RQ 캐시 직접 수정 헬퍼 ────────────────────────────────────
  const patchCache = useCallback(
    (updater: (old: Memo[]) => Memo[]) => {
      queryClient.setQueryData<Memo[]>(
        memoKeys.list(folderId, isTrash),
        (old) => updater(old ?? [])
      )
    },
    [queryClient, folderId, isTrash]
  )

  // ── 낙관적 업데이트: RQ 캐시 우선 수정, 실패 시 롤백 ─────────
  const optimisticPatch = useCallback(
    async (id: string, patch: Partial<Memo>, dbPatch: Record<string, unknown>) => {
      const snapshot = queryClient.getQueryData<Memo[]>(memoKeys.list(folderId, isTrash)) ?? []
      const original = snapshot.find((m) => m.id === id)

      patchCache((old) => old.map((m) => m.id === id ? { ...m, ...patch } : m))
      updateMemo(id, patch)

      const { error } = await supabase.from('memos').update(dbPatch).eq('id', id)
      if (error) {
        const rollback = Object.fromEntries(
          Object.entries(patch).map(([k]) => [k, original?.[k as keyof Memo]])
        ) as Partial<Memo>
        patchCache((old) => old.map((m) => m.id === id ? { ...m, ...rollback } : m))
        updateMemo(id, rollback)
        throw error
      }
      queryClient.invalidateQueries({ queryKey: memoKeys.list(folderId, isTrash) })
    },
    [patchCache, folderId, isTrash, queryClient]
  )

  const createMemo = useCallback(async () => {
    const { data: row, error } = await supabase
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
    const memo = toMemo(row)
    addMemo(memo)
    patchCache((old) => [memo, ...old])
    queryClient.invalidateQueries({ queryKey: memoKeys.list(folderId, isTrash) })
    return memo
  }, [folderId, isTrash, patchCache])

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
    const snapshot = queryClient.getQueryData<Memo[]>(memoKeys.list(folderId, isTrash)) ?? []
    const target = snapshot.find((m) => m.id === id)

    await supabase
      .from('memos')
      .update({ is_deleted: true, deleted_at: new Date().toISOString() })
      .eq('id', id)

    // 메모 목록에서 즉시 제거
    patchCache((old) => old.filter((m) => m.id !== id))
    deleteMemo(id)

    // 폴더 카운트 즉시 감소
    queryClient.setQueryData<Array<{ folder_id: string | null }>>(
      ['memo-folder-counts'],
      (old) => {
        if (!old) return old
        const targetFolderId = target?.folderId ?? null
        const idx = old.findIndex((row) => row.folder_id === targetFolderId)
        if (idx === -1) return old
        return [...old.slice(0, idx), ...old.slice(idx + 1)]
      }
    )

    queryClient.invalidateQueries({ queryKey: memoKeys.list(folderId, isTrash) })
    queryClient.invalidateQueries({ queryKey: ['memo-folder-counts'] })
  }, [folderId, isTrash, patchCache, queryClient])

  const lockMemo = useCallback(async (
    id: string,
    content: Record<string, unknown>,
    password: string
  ) => {
    let targetContent = content
    if (!content || Object.keys(content).length === 0) {
      const { data: row } = await supabase
        .from('memos')
        .select('content')
        .eq('id', id)
        .single()
      if (row?.content) targetContent = row.content as Record<string, unknown>
    }
    const encrypted = await encryptContent(JSON.stringify(targetContent), password)
    await supabase.from('memos').update({
      is_locked: true,
      locked_content: encrypted,
      content: null,
      content_text: '',
    }).eq('id', id)
    const lockPatch = { isLocked: true, lockedContent: encrypted, content: {}, contentText: '' }
    patchCache((old) => old.map((m) => m.id === id ? { ...m, ...lockPatch } : m))
    updateMemo(id, lockPatch)
    queryClient.invalidateQueries({ queryKey: memoKeys.list(folderId, isTrash) })
  }, [folderId, isTrash, patchCache])

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
    const unlockPatch = { isLocked: false, lockedContent: null, content }
    patchCache((old) => old.map((m) => m.id === id ? { ...m, ...unlockPatch } : m))
    updateMemo(id, unlockPatch)
    queryClient.invalidateQueries({ queryKey: memoKeys.list(folderId, isTrash) })
  }, [folderId, isTrash, patchCache])

  const restoreMemo = useCallback(async (id: string) => {
    await supabase.from('memos').update({ is_deleted: false, deleted_at: null }).eq('id', id)
    patchCache((old) => old.filter((m) => m.id !== id))
    deleteMemo(id)
    queryClient.invalidateQueries({ queryKey: memoKeys.list(null, false) })
    queryClient.invalidateQueries({ queryKey: ['memo-folder-counts'] })
  }, [patchCache])

  const bulkRestore = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return
    await supabase
      .from('memos')
      .update({ is_deleted: false, deleted_at: null })
      .in('id', ids)
    patchCache((old) => old.filter((m) => !ids.includes(m.id)))
    ids.forEach((id) => deleteMemo(id))
    queryClient.invalidateQueries({ queryKey: memoKeys.list(null, false) })
    queryClient.invalidateQueries({ queryKey: ['memo-folder-counts'] })
  }, [patchCache])

  const permanentDelete = useCallback(async (id: string) => {
    await supabase.from('memos').delete().eq('id', id)
    patchCache((old) => old.filter((m) => m.id !== id))
    deleteMemo(id)
  }, [patchCache])

  const moveMemoToFolder = useCallback(async (id: string, targetFolderId: string | null) => {
    await supabase.from('memos').update({ folder_id: targetFolderId }).eq('id', id)
    patchCache((old) => old.map((m) => m.id === id ? { ...m, folderId: targetFolderId } : m))
    updateMemo(id, { folderId: targetFolderId })
    queryClient.invalidateQueries({ queryKey: ['memos'] })
    queryClient.invalidateQueries({ queryKey: ['memo-folder-counts'] })
  }, [patchCache])

  const emptyTrash = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    await supabase.from('memos').delete().eq('user_id', user.id).eq('is_deleted', true)
    patchCache(() => [])
    setMemos([])
    queryClient.invalidateQueries({ queryKey: memoKeys.list(TRASH_ID, true) })
  }, [patchCache])

  return {
    // React Query data를 직접 반환 — 폴더 전환 시 stale Zustand 데이터 노출 방지
    memos: data ?? [],
    isLoading,
    isTrash,
    createMemo,
    togglePin,
    toggleStar,
    softDelete,
    lockMemo,
    unlockMemo,
    restoreMemo,
    bulkRestore,
    permanentDelete,
    emptyTrash,
    moveMemoToFolder,
    refresh: fetchMemos,
  }
}
