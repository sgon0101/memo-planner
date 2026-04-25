'use client'

import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'

interface AllMemosMeta {
  allTags: string[]
  allWikiLinks: string[]
}

export function useAllMemosMeta(): AllMemosMeta {
  const supabase = createClient()

  const { data } = useQuery({
    queryKey: ['memos-meta-global'],
    queryFn: async () => {
      const { data } = await supabase
        .from('memos')
        .select('tags, wiki_links')
        .eq('is_deleted', false)
      return data ?? []
    },
    staleTime: 5 * 60 * 1000, // 5분 캐시
    refetchOnWindowFocus: false,
  })

  const allTags = [...new Set((data ?? []).flatMap((m) => (m.tags as string[]) ?? []))].sort()
  const allWikiLinks = [...new Set((data ?? []).flatMap((m) => (m.wiki_links as string[]) ?? []))].sort()

  return { allTags, allWikiLinks }
}
