'use client'

/** 위키·색상 추천용 지난 플랜 (위키가 달린 것만, 최근 500개) — lib/planner/planHints.ts */

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createClient } from '@/lib/supabase/client'
import { buildPlanHints, type PlanHints } from '@/lib/planner/planHints'

export function usePlanHints(): PlanHints {
  const { data } = useQuery({
    queryKey: ['plan-hints'],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await createClient()
        .from('plans').select('title, color, wiki_links')
        .neq('wiki_links', '{}')
        .order('updated_at', { ascending: false })
        .limit(500)
      if (error) throw error
      return (data ?? []).map((r) => ({ title: r.title as string, color: r.color as string, wikiLinks: (r.wiki_links as string[]) ?? [] }))
    },
  })
  return useMemo(() => buildPlanHints(data ?? []), [data])
}
