'use client'

import { useState, useEffect, useRef } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { useFolders } from '@/hooks/useFolders'
import { memoKeys, toMemo } from '@/hooks/useMemos'
import MemoEditor from '@/components/memo/MemoEditor'
import type { Memo } from '@/types'

export default function MemoEditorClient() {
  const params = useParams()
  const id = params.id as string
  const searchParams = useSearchParams()
  const folder = searchParams.get('folder')
  const queryClient = useQueryClient()
  const { folders } = useFolders()

  const [memo, setMemo] = useState<Memo | null>(() => {
    if (id === 'new') return null
    const cached = queryClient.getQueryData<Memo[]>(memoKeys.all()) ?? []
    const found = cached.find((m) => m.id === id && !m.isDeleted)
    // content가 실제로 있는 경우만 캐시 사용 — 목록 캐시는 content를 포함하지 않음
    if (found && found.content && Object.keys(found.content).length > 0) return found
    return null
  })
  const [loading, setLoading] = useState(id !== 'new' && memo === null)
  const fetchedRef = useRef(false)

  useEffect(() => {
    if (id === 'new' || memo || fetchedRef.current) return
    fetchedRef.current = true

    createClient()
      .from('memos')
      .select('*')
      .eq('id', id)
      .eq('is_deleted', false)
      .single()
      .then(({ data }) => {
        setLoading(false)
        if (data) setMemo(toMemo(data as Record<string, unknown>))
      })
  }, [id, memo])

  if (id === 'new') {
    return (
      <MemoEditor
        memoId="new"
        initialTitle=""
        initialContent={{}}
        initialFolderId={folder}
        isNew
      />
    )
  }

  if (loading) return null

  if (!memo) return null

  const folderName = folders.find((f) => f.id === memo.folderId)?.name ?? null

  return (
    <MemoEditor
      memoId={memo.id}
      initialTitle={memo.title}
      initialContent={memo.content}
      initialIsStarred={memo.isStarred}
      initialIsPinned={memo.isPinned}
      initialFolderId={memo.folderId}
      initialFolderName={folderName}
    />
  )
}
