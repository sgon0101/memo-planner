'use client'

import { useCallback, useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useMemoStore } from '@/store/memoStore'
import { encryptContent, decryptContent, decryptAndMaybeUpgrade } from '@/lib/crypto/lock'
import { LIST_COLS, toMemo } from '@/lib/memos/shared'
import { safeUpdateOrForce } from '@/lib/db/safeUpdate'
import { writeOrQueue, createMemoOrQueue } from '@/lib/sync/withQueue'
import { makeTempId } from '@/lib/sync/queueDB'
import { broadcast } from '@/lib/sync/broadcast'
import { lsMemosCache, lsMemosCacheTs, lsHomeMemosCache, lsHomeMemosCacheTs } from '@/lib/cache/lsKeys'
import type { Memo } from '@/types'

export { toMemo, LIST_COLS } from '@/lib/memos/shared'

export const TRASH_ID = '__trash__'

/* localStorage 캐시 — userId namespacing 적용 (PR-4) */

export function readLocalCache(): Memo[] | undefined {
  if (typeof window === 'undefined') return undefined
  const key = lsMemosCache()
  if (!key) return undefined
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return undefined
    const parsed = JSON.parse(raw) as Memo[]
    return parsed.length > 0 ? parsed : undefined
  } catch {
    return undefined
  }
}

export function readLocalCacheTs(): number {
  if (typeof window === 'undefined') return 0
  const key = lsMemosCacheTs()
  if (!key) return 0
  try {
    const ts = localStorage.getItem(key)
    return ts ? parseInt(ts, 10) : 0
  } catch {
    return 0
  }
}

export function writeLocalCache(memos: Memo[]) {
  if (memos.length === 0) return
  const key = lsMemosCache()
  const tsKey = lsMemosCacheTs()
  if (!key || !tsKey) return
  try {
    const stripped = memos.map((m) => ({ ...m, content: {} as Record<string, unknown> }))
    const json = JSON.stringify(stripped)
    localStorage.setItem(key, json)
    localStorage.setItem(tsKey, String(Date.now()))
    if (typeof window !== 'undefined' && (window as unknown as { __WEAVE_DEBUG__?: boolean }).__WEAVE_DEBUG__) {
      console.log(`[writeLocalCache] OK: ${memos.length} memos, ${(json.length / 1024).toFixed(1)} KB`)
    }
  } catch (e) {
    if (typeof window !== 'undefined') {
      console.error('[writeLocalCache] FAILED:', e instanceof Error ? e.message : e)
    }
  }
}

export const memoKeys = {
  all: () => ['memos', 'all', false] as const,
  trash: () => ['memos', 'trash'] as const,
  list: (_folderId: string | null | undefined, isTrash: boolean) =>
    isTrash ? (['memos', 'trash'] as const) : (['memos', 'all', false] as const),
}

export function useMemos(folderId: string | null | undefined) {
  const { setMemos, addMemo, updateMemo, deleteMemo } = useMemoStore()
  const supabase = createClient()
  const queryClient = useQueryClient()
  const isTrash = folderId === TRASH_ID

  const fetchAll = useCallback(async (): Promise<Memo[]> => {
    const { data, error } = await supabase
      .from('memos')
      .select(LIST_COLS)
      .eq('is_deleted', false)
      .order('is_pinned', { ascending: false })
      .order('updated_at', { ascending: false })
    if (error) {
      console.error('[fetchAll] supabase error:', error)
      throw error
    }
    return (data ?? []).map(toMemo)
  }, [supabase])

  const fetchTrash = useCallback(async (): Promise<Memo[]> => {
    const { data } = await supabase
      .from('memos')
      .select(LIST_COLS)
      .eq('is_deleted', true)
      .order('deleted_at', { ascending: false })
    return (data ?? []).map(toMemo)
  }, [supabase])

  const queryKey = isTrash ? memoKeys.trash() : memoKeys.all()

  const { isLoading, isFetching, data: allData } = useQuery({
    queryKey,
    queryFn: isTrash ? fetchTrash : fetchAll,
    ...(isTrash ? {} : {
      initialData: readLocalCache,
      initialDataUpdatedAt: readLocalCacheTs,
    }),
  })

  useEffect(() => {
    if (allData && !isTrash) writeLocalCache(allData)
  }, [allData, isTrash])

  const data = useMemo(() => {
    if (!allData) return undefined
    if (isTrash) return allData
    if (folderId === undefined || folderId === null) return allData
    return allData.filter((m) => m.folderId === folderId)
  }, [allData, folderId, isTrash])

  useEffect(() => {
    if (allData) setMemos(allData)
  }, [allData, setMemos])

  const patchCache = useCallback(
    (updater: (old: Memo[]) => Memo[]) => {
      queryClient.setQueryData<Memo[]>(queryKey, (old) => updater(old ?? []))
    },
    [queryClient, queryKey]
  )

  /* PR-4: Silent + auto-force update */
  const optimisticPatch = useCallback(
    async (id: string, patch: Partial<Memo>, dbPatch: Record<string, unknown>) => {
      const snapshot = queryClient.getQueryData<Memo[]>(queryKey) ?? []
      const original = snapshot.find((m) => m.id === id)
      if (!original) return
      const knownUpdatedAt = original.updatedAt

      patchCache((old) => old.map((m) => m.id === id ? { ...m, ...patch } : m))
      updateMemo(id, patch)

      try {
        // PR-M1-A: online이면 직접 update, offline이면 큐
        const result = await writeOrQueue({
          table: 'memos', recordId: id, patch: dbPatch, knownUpdatedAt,
        })
        if (result.queued) {
          // 오프라인 — optimistic UI 유지, broadcast/홈 invalidate는 flush 때
          // updated_at은 임시로 now()
          const tempUpdatedAt = new Date().toISOString()
          patchCache((old) => old.map((m) => m.id === id ? { ...m, updatedAt: tempUpdatedAt } : m))
          updateMemo(id, { updatedAt: tempUpdatedAt })
        } else {
          // online 직접 update 성공
          const updated_at = result.updated_at!
          const finalPatch: Partial<Memo> = { ...patch, updatedAt: updated_at }
          patchCache((old) => old.map((m) => m.id === id ? { ...m, updatedAt: updated_at } : m))
          updateMemo(id, { updatedAt: updated_at })
          broadcast({ type: 'memo-update', id, patch: finalPatch, updated_at })
          queryClient.invalidateQueries({ queryKey: ['home-memos'] })
        }
      } catch (e) {
        const rollback = Object.fromEntries(
          Object.entries(patch).map(([k]) => [k, original[k as keyof Memo]])
        ) as Partial<Memo>
        patchCache((old) => old.map((m) => m.id === id ? { ...m, ...rollback } : m))
        updateMemo(id, rollback)
        throw e
      }
    },
    [patchCache, queryKey, queryClient, updateMemo]
  )

  /**
   * PR-M1-B: 메모 신규 작성 — online이면 즉시 server insert, offline이면 임시 ID + 큐.
   * 임시 ID로 UI에 먼저 표시 → 큐 flush 시 SyncBootstrap이 swapId로 진짜 ID 교체.
   *
   * PR-M1-B 핫픽스: getUser()는 offline에서 토큰 refresh fetch 실패로 throw → user_id=''로 큐 적재 후 복귀 시 RLS 400.
   * getSession()은 cookie/localStorage에서 sync 읽기 → 네트워크 호출 없음, offline-safe.
   */
  const createMemo = useCallback(async () => {
    const tempId = makeTempId('memo')
    const { data: { session } } = await supabase.auth.getSession()
    const userId = session?.user?.id
    if (!userId) {
      throw new Error('로그인 세션이 만료되었어요. 다시 로그인해주세요.')
    }
    const nowIso = new Date().toISOString()
    const fields = {
      user_id: userId,
      title: '',
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
      content_text: '',
      folder_id: folderId ?? null,
    }

    const result = await createMemoOrQueue(fields, tempId)

    if (result.queued) {
      // offline — 임시 ID + 임시 timestamp로 UI 즉시 표시
      const tempMemo: Memo = {
        id: tempId,
        userId,
        folderId: folderId ?? null,
        title: '',
        content: { type: 'doc', content: [{ type: 'paragraph' }] } as Record<string, unknown>,
        contentText: '',
        isPinned: false,
        isStarred: false,
        isLocked: false,
        lockedContent: null,
        isDeleted: false,
        deletedAt: null,
        tags: [],
        wikiLinks: [],
        linkedPlanIds: [],
        thumbnailUrl: null,
        createdAt: nowIso,
        updatedAt: nowIso,
      }
      addMemo(tempMemo)
      patchCache((old) => [tempMemo, ...old])
      // broadcast / home invalidate는 flush 후에
      return tempMemo
    }

    const memo = toMemo(result.row!)
    addMemo(memo)
    patchCache((old) => [memo, ...old])
    broadcast({ type: 'memo-create', memo })
    queryClient.invalidateQueries({ queryKey: ['home-memos'] })
    return memo
  }, [folderId, patchCache, supabase, addMemo, queryClient])

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
    const { error } = await supabase
      .from('memos')
      .update({ is_deleted: true, deleted_at: new Date().toISOString() })
      .eq('id', id)
    if (error) throw error

    const target = (queryClient.getQueryData<Memo[]>(memoKeys.all()) ?? [])
      .find((m) => m.id === id)
    const targetFolderId = target?.folderId ?? null

    patchCache((old) => old.filter((m) => m.id !== id))
    deleteMemo(id)
    broadcast({ type: 'memo-delete', id })

    queryClient.setQueryData<Array<{ folder_id: string | null }>>(
      ['memo-folder-counts'],
      (old) => {
        if (!old) return old
        const idx = old.findIndex((row) => row.folder_id === targetFolderId)
        if (idx === -1) return old
        return [...old.slice(0, idx), ...old.slice(idx + 1)]
      }
    )
    queryClient.invalidateQueries({ queryKey: ['memo-folder-counts'] })

    queryClient.setQueryData<{ recentMemos: Array<{ id: string }> } | undefined>(
      ['home-memos'],
      (old) => old ? { ...old, recentMemos: old.recentMemos.filter((m) => m.id !== id) } : old,
    )
    queryClient.invalidateQueries({ queryKey: ['home-memos'] })

    if (typeof window !== 'undefined') {
      try {
        const k = lsHomeMemosCache()
        const kts = lsHomeMemosCacheTs()
        if (k) {
          const raw = localStorage.getItem(k)
          if (raw) {
            const parsed = JSON.parse(raw) as { recentMemos: Array<{ id: string }> }
            const next = { ...parsed, recentMemos: parsed.recentMemos.filter((m) => m.id !== id) }
            localStorage.setItem(k, JSON.stringify(next))
            if (kts) localStorage.setItem(kts, String(Date.now()))
          }
        }
      } catch { /* ignore */ }
    }
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

    const snapshot = queryClient.getQueryData<Memo[]>(queryKey) ?? []
    const original = snapshot.find((m) => m.id === id)
    const knownUpdatedAt = original?.updatedAt ?? new Date().toISOString()

    const { updated_at } = await safeUpdateOrForce(
      {
        table: 'memos',
        id,
        patch: { is_locked: true, locked_content: encrypted, content: null, content_text: '' },
        knownUpdatedAt,
      },
      () => console.warn('[weave:conflict] memos lockMemo', id),
    )

    const lockPatch: Partial<Memo> = {
      isLocked: true,
      lockedContent: encrypted,
      content: {} as Record<string, unknown>,
      contentText: '',
      updatedAt: updated_at,
    }
    patchCache((old) => old.map((m) => m.id === id ? { ...m, ...lockPatch } : m))
    updateMemo(id, lockPatch)
    broadcast({ type: 'memo-update', id, patch: lockPatch, updated_at })

    // PR-2: 잠금 시점에 기존 평문 버전 이력 일괄 삭제 (보안)
    // 사용자 알림 토스트 없이 silent — 잠금이 데이터 보호의 의도이므로
    try {
      await supabase.from('memo_versions').delete().eq('memo_id', id)
    } catch { /* silent */ }
  }, [patchCache, queryClient, queryKey, supabase, updateMemo])

  const unlockMemo = useCallback(async (
    id: string,
    lockedContent: string,
    password: string
  ) => {
    // PR-2: 옛 v1 ciphertext면 자동으로 v2(600k iter)로 업그레이드
    const { plaintext, upgraded } = await decryptAndMaybeUpgrade(lockedContent, password)
    const content = JSON.parse(plaintext) as Record<string, unknown>

    // 옛 v1이었으면 v2 ciphertext를 DB에도 미리 한 번 갱신
    // (다음에 다시 잠그면 v2가 적용되지만, locked_content 자체도 일관성 위해 갱신)
    if (upgraded) {
      try {
        await supabase.from('memos').update({ locked_content: upgraded }).eq('id', id)
      } catch { /* silent — 다음 unlock에서 재시도 */ }
    }

    const snapshot = queryClient.getQueryData<Memo[]>(queryKey) ?? []
    const original = snapshot.find((m) => m.id === id)
    const knownUpdatedAt = original?.updatedAt ?? new Date().toISOString()

    const { updated_at } = await safeUpdateOrForce(
      {
        table: 'memos',
        id,
        patch: { is_locked: false, locked_content: null, content },
        knownUpdatedAt,
      },
      () => console.warn('[weave:conflict] memos unlockMemo', id),
    )

    const unlockPatch: Partial<Memo> = {
      isLocked: false,
      lockedContent: null,
      content,
      updatedAt: updated_at,
    }
    patchCache((old) => old.map((m) => m.id === id ? { ...m, ...unlockPatch } : m))
    updateMemo(id, unlockPatch)
    broadcast({ type: 'memo-update', id, patch: unlockPatch, updated_at })
  }, [patchCache, queryClient, queryKey, supabase, updateMemo])

  const restoreMemo = useCallback(async (id: string) => {
    await supabase.from('memos').update({ is_deleted: false, deleted_at: null }).eq('id', id)
    patchCache((old) => old.filter((m) => m.id !== id))
    deleteMemo(id)
    queryClient.invalidateQueries({ queryKey: memoKeys.all() })
    queryClient.invalidateQueries({ queryKey: ['memo-folder-counts'] })
    queryClient.invalidateQueries({ queryKey: ['home-memos'] })
    broadcast({ type: 'invalidate', queryKey: ['memos', 'all', false] })
    broadcast({ type: 'invalidate', queryKey: ['memo-folder-counts'] })
  }, [patchCache, queryClient, supabase, deleteMemo])

  const bulkRestore = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return
    await supabase.from('memos').update({ is_deleted: false, deleted_at: null }).in('id', ids)
    patchCache((old) => old.filter((m) => !ids.includes(m.id)))
    ids.forEach((id) => deleteMemo(id))
    queryClient.invalidateQueries({ queryKey: memoKeys.all() })
    queryClient.invalidateQueries({ queryKey: ['memo-folder-counts'] })
    queryClient.invalidateQueries({ queryKey: ['home-memos'] })
    broadcast({ type: 'invalidate', queryKey: ['memos', 'all', false] })
  }, [patchCache, queryClient, supabase, deleteMemo])

  const permanentDelete = useCallback(async (id: string) => {
    await supabase.from('memos').delete().eq('id', id)
    patchCache((old) => old.filter((m) => m.id !== id))
    deleteMemo(id)
    broadcast({ type: 'memo-delete', id })
  }, [patchCache, supabase, deleteMemo])

  const moveMemoToFolder = useCallback(async (id: string, targetFolderId: string | null) => {
    await optimisticPatch(id, { folderId: targetFolderId }, { folder_id: targetFolderId })
    queryClient.invalidateQueries({ queryKey: ['memo-folder-counts'] })
  }, [optimisticPatch, queryClient])

  const emptyTrash = useCallback(async () => {
    // 정리 잔여: getUser→getSession (offline-safe)
    const { data: { session } } = await supabase.auth.getSession()
    const user = session?.user ?? null
    if (!user) return
    await supabase.from('memos').delete().eq('user_id', user.id).eq('is_deleted', true)
    patchCache(() => [])
    setMemos([])
    broadcast({ type: 'invalidate', queryKey: ['memos', 'trash'] })
  }, [patchCache, supabase, setMemos])

  return {
    memos: data ?? [],
    isLoading,
    isFetching,
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
