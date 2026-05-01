'use client'

import { useCallback, useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useMemoStore } from '@/store/memoStore'
import { encryptContent, decryptContent } from '@/lib/crypto/lock'
import { LIST_COLS, toMemo } from '@/lib/memos/shared'
import type { Memo } from '@/types'

export { toMemo, LIST_COLS } from '@/lib/memos/shared'

export const TRASH_ID = '__trash__'

const SS_KEY = 'memos-all-cache'
const SS_TS_KEY = 'memos-all-cache-ts'

function readSessionCache(): Memo[] | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    const raw = sessionStorage.getItem(SS_KEY)
    return raw ? (JSON.parse(raw) as Memo[]) : undefined
  } catch {
    return undefined
  }
}

function readSessionCacheTs(): number {
  if (typeof window === 'undefined') return 0
  try {
    const ts = sessionStorage.getItem(SS_TS_KEY)
    return ts ? parseInt(ts, 10) : 0
  } catch {
    return 0
  }
}

function writeSessionCache(memos: Memo[]) {
  try {
    sessionStorage.setItem(SS_KEY, JSON.stringify(memos))
    sessionStorage.setItem(SS_TS_KEY, String(Date.now()))
  } catch {
    // 용량 초과 시 무시 — 기능에는 영향 없음
  }
}

// 전체 활성 메모 단일 키 — 폴더 필터링은 클라이언트에서 수행
export const memoKeys = {
  all: () => ['memos', 'all', false] as const,
  trash: () => ['memos', 'trash'] as const,
  // 하위 호환 — 항상 단일 키 반환 (folderId 무시)
  list: (_folderId: string | null | undefined, isTrash: boolean) =>
    isTrash ? (['memos', 'trash'] as const) : (['memos', 'all', false] as const),
}

export function useMemos(folderId: string | null | undefined) {
  const { setMemos, addMemo, updateMemo, deleteMemo } = useMemoStore()
  const supabase = createClient()
  const queryClient = useQueryClient()
  const isTrash = folderId === TRASH_ID

  // 전체 활성 메모 1회 fetch (폴더 무관)
  const fetchAll = useCallback(async (): Promise<Memo[]> => {
    const { data } = await supabase
      .from('memos')
      .select(LIST_COLS)
      .eq('is_deleted', false)
      .order('is_pinned', { ascending: false })
      .order('updated_at', { ascending: false })
    return (data ?? []).map(toMemo)
  }, [supabase])

  // 휴지통 별도 fetch
  const fetchTrash = useCallback(async (): Promise<Memo[]> => {
    const { data } = await supabase
      .from('memos')
      .select(LIST_COLS)
      .eq('is_deleted', true)
      .order('deleted_at', { ascending: false })
    return (data ?? []).map(toMemo)
  }, [supabase])

  const queryKey = isTrash ? memoKeys.trash() : memoKeys.all()

  const { isLoading, data: allData } = useQuery({
    queryKey,
    queryFn: isTrash ? fetchTrash : fetchAll,
    // 새로고침 시 sessionStorage에서 즉시 복원 → 화면 바로 표시
    // initialDataUpdatedAt 기준으로 staleTime 계산 → 백그라운드 refetch 여부 결정
    ...(isTrash ? {} : {
      initialData: readSessionCache,
      initialDataUpdatedAt: readSessionCacheTs,
    }),
  })

  // fetch 완료(또는 갱신) 시 sessionStorage에 저장
  useEffect(() => {
    if (allData && !isTrash) writeSessionCache(allData)
  }, [allData, isTrash])

  // folderId로 클라이언트 필터링 — 추가 fetch 없이 즉각 반응
  // null·undefined 모두 전체 보기 (기존 fetchMemos 동작과 동일)
  const data = useMemo(() => {
    if (!allData) return undefined
    if (isTrash) return allData
    if (folderId === undefined || folderId === null) return allData
    return allData.filter((m) => m.folderId === folderId)
  }, [allData, folderId, isTrash])

  // Zustand 보조 동기화 (MemoEditor 등 호환)
  useEffect(() => {
    if (allData) setMemos(allData)
  }, [allData, setMemos])

  // ── 캐시 직접 수정 헬퍼 ───────────────────────────────────────
  const patchCache = useCallback(
    (updater: (old: Memo[]) => Memo[]) => {
      queryClient.setQueryData<Memo[]>(queryKey, (old) => updater(old ?? []))
    },
    [queryClient, queryKey]
  )

  // ── 낙관적 업데이트 ───────────────────────────────────────────
  const optimisticPatch = useCallback(
    async (id: string, patch: Partial<Memo>, dbPatch: Record<string, unknown>) => {
      const snapshot = queryClient.getQueryData<Memo[]>(queryKey) ?? []
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
    },
    [patchCache, queryKey, queryClient, updateMemo, supabase]
  )

  const createMemo = useCallback(async () => {
    const { data: row, error } = await supabase
      .from('memos')
      .insert({
        title: '',
        content: { type: 'doc', content: [{ type: 'paragraph' }] },
        content_text: '',
        folder_id: folderId ?? null,
      })
      .select()
      .single()
    if (error) throw error
    const memo = toMemo(row)
    addMemo(memo)
    patchCache((old) => [memo, ...old])
    return memo
  }, [folderId, patchCache, supabase, addMemo])

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

    // 전체 캐시에서 제거
    patchCache((old) => old.filter((m) => m.id !== id))
    deleteMemo(id)

    queryClient.setQueryData<Array<{ folder_id: string | null }>>(
      ['memo-folder-counts'],
      (old) => {
        if (!old) return old
        const target = (queryClient.getQueryData<Memo[]>(memoKeys.all()) ?? [])
          .find((m) => m.id === id)
        const targetFolderId = target?.folderId ?? null
        const idx = old.findIndex((row) => row.folder_id === targetFolderId)
        if (idx === -1) return old
        return [...old.slice(0, idx), ...old.slice(idx + 1)]
      }
    )
    queryClient.invalidateQueries({ queryKey: ['memo-folder-counts'] })
  }, [patchCache, queryClient, supabase, deleteMemo])

  const lockMemo = useCallback(async (
    id: string,
    content: Record<string, unknown>,
    password: string
  ) => {
    let targetContent = content
    if (!content || Object.keys(content).length === 0) {
      const { data: row } = await supabase.from('memos').select('content').eq('id', id).single()
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
  }, [patchCache, supabase, updateMemo])

  const unlockMemo = useCallback(async (
    id: string,
    lockedContent: string,
    password: string
  ) => {
    const plaintext = await decryptContent(lockedContent, password)
    const content = JSON.parse(plaintext) as Record<string, unknown>
    await supabase.from('memos').update({ is_locked: false, locked_content: null, content }).eq('id', id)
    const unlockPatch = { isLocked: false, lockedContent: null, content }
    patchCache((old) => old.map((m) => m.id === id ? { ...m, ...unlockPatch } : m))
    updateMemo(id, unlockPatch)
  }, [patchCache, supabase, updateMemo])

  const restoreMemo = useCallback(async (id: string) => {
    await supabase.from('memos').update({ is_deleted: false, deleted_at: null }).eq('id', id)
    // 휴지통 캐시에서 제거
    patchCache((old) => old.filter((m) => m.id !== id))
    deleteMemo(id)
    // 전체 메모 캐시 무효화 → 복원된 메모가 포함된 최신 목록 fetch
    queryClient.invalidateQueries({ queryKey: memoKeys.all() })
    queryClient.invalidateQueries({ queryKey: ['memo-folder-counts'] })
  }, [patchCache, queryClient, supabase, deleteMemo])

  const bulkRestore = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return
    await supabase
      .from('memos')
      .update({ is_deleted: false, deleted_at: null })
      .in('id', ids)
    patchCache((old) => old.filter((m) => !ids.includes(m.id)))
    ids.forEach((id) => deleteMemo(id))
    queryClient.invalidateQueries({ queryKey: memoKeys.all() })
    queryClient.invalidateQueries({ queryKey: ['memo-folder-counts'] })
  }, [patchCache, queryClient, supabase, deleteMemo])

  const permanentDelete = useCallback(async (id: string) => {
    await supabase.from('memos').delete().eq('id', id)
    patchCache((old) => old.filter((m) => m.id !== id))
    deleteMemo(id)
  }, [patchCache, supabase, deleteMemo])

  const moveMemoToFolder = useCallback(async (id: string, targetFolderId: string | null) => {
    await supabase.from('memos').update({ folder_id: targetFolderId }).eq('id', id)
    // 전체 캐시에서 해당 메모의 folderId 업데이트
    queryClient.setQueryData<Memo[]>(memoKeys.all(), (old) =>
      old?.map((m) => m.id === id ? { ...m, folderId: targetFolderId } : m)
    )
    updateMemo(id, { folderId: targetFolderId })
    queryClient.invalidateQueries({ queryKey: ['memo-folder-counts'] })
  }, [queryClient, supabase, updateMemo])

  const emptyTrash = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    await supabase.from('memos').delete().eq('user_id', user.id).eq('is_deleted', true)
    patchCache(() => [])
    setMemos([])
  }, [patchCache, supabase, setMemos])

  return {
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
    refresh: isTrash ? fetchTrash : fetchAll,
  }
}
