'use client'

/**
 * 메모 서버 검색 hook (#9 — Postgres FTS)
 *
 * - 검색어 debounce 300ms
 * - React Query 캐싱 (staleTime 30s) — 같은 쿼리 반복 시 즉시 표시
 * - 검색어 비면 비활성 (서버 호출 X)
 *
 * 반환:
 *   results — Memo[] | undefined
 *   isLoading — true면 첫 로딩 (이전 데이터 X)
 *   isFetching — true면 어떤 fetch라도 진행 중
 *   debouncedQuery — 실제 서버에 보낸 query (UI 표시 동기화용)
 */

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { Memo } from '@/types'

const DEBOUNCE_MS = 300

export interface UseMemoSearchOptions {
  /** 검색어 (raw, debounce 전) */
  query: string
  /** 폴더 ID. null = 전체, 'trash' = 휴지통 */
  folderId: string | null | 'trash'
  /** 한 번에 가져올 최대 개수 */
  limit?: number
}

interface SearchResponse {
  results: Memo[]
  total: number
}

export function useMemoSearch({ query, folderId, limit = 100 }: UseMemoSearchOptions) {
  const [debouncedQuery, setDebouncedQuery] = useState('')

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query.trim()), DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [query])

  const folderParam = folderId === 'trash' ? 'trash' : (folderId ?? 'all')
  const enabled = debouncedQuery.length > 0

  const { data, isLoading, isFetching } = useQuery<SearchResponse & { semantic?: boolean }>({
    queryKey: ['memo-search', debouncedQuery, folderParam, limit],
    queryFn: async () => {
      const params = new URLSearchParams({
        q: debouncedQuery,
        folder: folderParam,
        limit: String(limit),
      })
      const res = await fetch(`/api/memos/search?${params}`)
      if (!res.ok) throw new Error(`search ${res.status}`)
      const fts = (await res.json()) as SearchResponse

      // 시맨틱 폴백 — FTS 0건이면 임베딩 유사도 검색으로 한 번 더
      // ("정확한 단어가 기억나지 않는" 검색 실패 구제)
      // match_memos는 폴더 필터가 없으므로 전체 검색일 때만 폴백 (폴더/휴지통 검색 제외)
      if (fts.results.length === 0 && debouncedQuery.length >= 2 && folderParam === 'all') {
        try {
          const semRes = await fetch(`/api/memos/search-semantic?q=${encodeURIComponent(debouncedQuery)}`)
          if (semRes.ok) {
            const sem = (await semRes.json()) as SearchResponse & { semantic?: boolean }
            if (sem.results.length > 0) return { ...sem, semantic: true }
          }
        } catch { /* 폴백 실패는 조용히 무시 — FTS 빈 결과 유지 */ }
      }
      return fts
    },
    enabled,
    staleTime: 30_000,
  })

  return {
    results: data?.results,
    /** true면 현재 결과가 FTS가 아닌 의미(임베딩) 검색 폴백 결과 */
    isSemanticResult: data?.semantic === true,
    isLoading: enabled && isLoading,
    isFetching: enabled && isFetching,
    debouncedQuery,
    isSearching: enabled,
  }
}
