'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { buildCanonicalMap, tagKey, wikiKey } from '@/lib/wiki/normalize'

interface AllMemosMeta {
  /** 대표 표기로 dedupe + 사용 횟수 내림차순 */
  allTags: string[]
  /** 대표 표기로 dedupe + 사용 횟수 내림차순 */
  allWikiLinks: string[]
  /** 정규화 키 → 대표 표기 (AI 후처리·필터 비교에서 재사용) */
  wikiCanonical: Map<string, string>
  tagCanonical: Map<string, string>
}

const EMPTY_MAP: Map<string, string> = new Map()

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

  return useMemo(() => {
    const rows = data ?? []
    if (rows.length === 0) {
      return { allTags: [], allWikiLinks: [], wikiCanonical: EMPTY_MAP, tagCanonical: EMPTY_MAP }
    }

    const wikiEntries = rows.flatMap((m) => ((m.wiki_links as string[]) ?? []).map((label) => ({ label, count: 1 })))
    const tagEntries = rows.flatMap((m) => ((m.tags as string[]) ?? []).map((label) => ({ label, count: 1 })))

    const wikiCanonical = buildCanonicalMap(wikiEntries, wikiKey)
    const tagCanonical = buildCanonicalMap(tagEntries, tagKey)

    return {
      // 자주 쓰는 허브가 자동완성 위쪽에 오도록 사용 횟수 내림차순 (동률은 가나다)
      allWikiLinks: rankByUsage(wikiEntries, wikiCanonical, wikiKey),
      allTags: rankByUsage(tagEntries, tagCanonical, tagKey),
      wikiCanonical,
      tagCanonical,
    }
  }, [data])
}

/** 키별 사용 횟수를 합산해 대표 표기를 횟수 내림차순으로 정렬 */
function rankByUsage(
  entries: Array<{ label: string; count: number }>,
  canonical: Map<string, string>,
  keyFn: (label: string) => string,
): string[] {
  const counts = new Map<string, number>()
  for (const { label, count } of entries) {
    const key = keyFn(label.trim())
    if (!key) continue
    counts.set(key, (counts.get(key) ?? 0) + count)
  }
  return [...counts.entries()]
    .sort((a, b) => (b[1] - a[1]) || (canonical.get(a[0]) ?? a[0]).localeCompare(canonical.get(b[0]) ?? b[0], 'ko'))
    .map(([key]) => canonical.get(key) ?? key)
}
