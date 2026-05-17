'use client'

import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { memoKeys, LIST_COLS, toMemo, writeLocalCache } from '@/hooks/useMemos'

// 레이아웃 레벨에서 메모 목록을 최대한 일찍 백그라운드 prefetch
// → 메모 탭 진입 전에 캐시를 채워 즉각 표시 가능하게 함
export function MemoListPrefetch() {
  const queryClient = useQueryClient()

  useEffect(() => {
    queryClient
      .fetchQuery({
        queryKey: memoKeys.all(),
        queryFn: async () => {
          const supabase = createClient()
          const { data } = await supabase
            .from('memos')
            .select(LIST_COLS)
            .eq('is_deleted', false)
            .order('is_pinned', { ascending: false })
            .order('updated_at', { ascending: false })
          return (data ?? []).map(toMemo)
        },
        staleTime: 5 * 60 * 1000,
      })
      .then(writeLocalCache)
      .catch(() => {})
  }, [queryClient])

  return null
}
