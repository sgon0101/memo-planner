'use client'

import { useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { MemoVersion } from '@/types'

const MAX_VERSIONS = 20

function toVersion(row: Record<string, unknown>): MemoVersion {
  return {
    id: row.id as string,
    memoId: row.memo_id as string,
    content: (row.content as Record<string, unknown>) ?? {},
    contentText: (row.content_text as string) ?? '',
    title: (row.title as string) ?? '',
    createdAt: row.created_at as string,
  }
}

export function useVersions(memoId: string | null) {
  const [versions, setVersions] = useState<MemoVersion[]>([])
  const supabase = createClient()

  const load = useCallback(async () => {
    if (!memoId || memoId === 'new') return
    const { data } = await supabase
      .from('memo_versions')
      .select('*')
      .eq('memo_id', memoId)
      .order('created_at', { ascending: false })
      .limit(MAX_VERSIONS)
    if (data) setVersions(data.map(toVersion))
  }, [memoId])

  const saveVersion = useCallback(async (
    content: Record<string, unknown>,
    contentText: string,
    title: string,
    /** PR-2: 잠금 메모면 버전 평문 저장 skip (보안) */
    isLocked: boolean = false,
  ) => {
    if (!memoId || memoId === 'new') return
    // 잠금 메모는 평문 버전 이력을 만들지 않음
    if (isLocked) return

    await supabase.from('memo_versions').insert({ memo_id: memoId, content, content_text: contentText, title })

    // 오래된 버전 정리 (MAX_VERSIONS 초과 시)
    const { data } = await supabase
      .from('memo_versions')
      .select('id')
      .eq('memo_id', memoId)
      .order('created_at', { ascending: false })
    if (data && data.length > MAX_VERSIONS) {
      const toDelete = data.slice(MAX_VERSIONS).map((v) => v.id as string)
      await supabase.from('memo_versions').delete().in('id', toDelete)
    }
    await load()
  }, [memoId, load])

  const deleteVersion = useCallback(async (id: string) => {
    await supabase.from('memo_versions').delete().eq('id', id)
    setVersions((v) => v.filter((ver) => ver.id !== id))
  }, [])

  return { versions, load, saveVersion, deleteVersion }
}
