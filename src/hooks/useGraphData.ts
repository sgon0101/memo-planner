'use client'

import { useEffect, useLayoutEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useGraphStore, type GraphNode, type GraphLink } from '@/store/graphStore'
import { useFolderStore } from '@/store/folderStore'
import type { Memo, Folder } from '@/types'

// Supabase에서 내려오는 snake_case 원시 행
interface RawMemo {
  id: string
  title: string
  content_text: string | null
  tags: string[] | null
  wiki_links: string[] | null
  is_starred: boolean
  is_pinned: boolean
  folder_id: string | null
  created_at: string
}

interface RawData {
  memos: RawMemo[]
  simLinks: Array<{ source: string; target: string }>
}

function toMemoNode(m: Memo & { created_at?: string; content_text?: string }, linkCount: number): GraphNode {
  return {
    id: m.id,
    type: 'memo',
    label: m.title || '제목 없음',
    linkCount,
    isStarred: m.isStarred,
    folderId: m.folderId,
    createdAt: m.createdAt ?? (m as unknown as Record<string, string>).created_at,
    contentText: m.contentText ?? (m as unknown as Record<string, string>).content_text ?? '',
  }
}

function toFolder(row: Record<string, unknown>): Folder {
  return {
    id: row.id as string,
    userId: row.user_id as string,
    name: row.name as string,
    colorH: (row.color_h as number) ?? 260,
    colorS: (row.color_s as number) ?? 60,
    colorL: (row.color_l as number) ?? 80,
    parentId: (row.parent_id as string) ?? null,
    orderIndex: (row.order_index as number) ?? 0,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }
}

export function useGraphData() {
  const { settings, setNodes, setLinks } = useGraphStore()
  const { setFolders } = useFolderStore()
  const supabase = createClient()

  const settingsRef = useRef(settings)
  useLayoutEffect(() => { settingsRef.current = settings })

  // 네트워크 응답 캐시 — settings 토글 시 재사용
  const rawRef = useRef<RawData | null>(null)

  // 로컬 계산만 수행 — 네트워크 없음, 즉각 반영
  const buildGraph = useCallback(() => {
    if (!rawRef.current) return
    const s = settingsRef.current
    const { memos, simLinks } = rawRef.current

    const nodes: GraphNode[] = []
    const links: GraphLink[] = []
    const wikiMap = new Map<string, string>()
    const tagMap = new Map<string, string>()

    // 1단계: 위키/태그 허브 노드 수집
    for (const m of memos) {
      if (s.showWiki) {
        for (const kw of (m.wiki_links ?? [])) {
          if (!wikiMap.has(kw)) wikiMap.set(kw, `wiki:${kw}`)
        }
      }
      if (s.showTag) {
        for (const tag of (m.tags ?? [])) {
          if (!tagMap.has(tag)) tagMap.set(tag, `tag:${tag}`)
        }
      }
    }

    // 2단계: 링크 생성 (위키 + 태그)
    const memoLinkCounts = new Map<string, number>()
    for (const m of memos) {
      let count = 0
      if (s.showWiki) {
        for (const kw of (m.wiki_links ?? [])) {
          if (wikiMap.has(kw)) {
            links.push({ source: m.id, target: wikiMap.get(kw)!, type: 'wiki' })
            count++
          }
        }
      }
      if (s.showTag) {
        for (const tag of (m.tags ?? [])) {
          if (tagMap.has(tag)) {
            links.push({ source: m.id, target: tagMap.get(tag)!, type: 'tag' })
            count++
          }
        }
      }
      memoLinkCounts.set(m.id, count)
    }

    // 3단계: 유사도 링크 (캐시된 결과 재사용)
    for (const sl of simLinks) {
      if (
        memos.some((m) => m.id === sl.source) &&
        memos.some((m) => m.id === sl.target)
      ) {
        links.push({ source: sl.source, target: sl.target, type: 'similarity' })
        memoLinkCounts.set(sl.source, (memoLinkCounts.get(sl.source) ?? 0) + 1)
        memoLinkCounts.set(sl.target, (memoLinkCounts.get(sl.target) ?? 0) + 1)
      }
    }

    // 4단계: 메모 노드 생성 (고립 필터)
    for (const m of memos) {
      const lc = memoLinkCounts.get(m.id) ?? 0
      if (!s.showIsolated && lc === 0) continue
      nodes.push(toMemoNode(m as unknown as Memo & { wiki_links: string[] }, lc))
    }

    // 5단계: 위키/태그 허브 노드 생성
    if (s.showWiki) {
      for (const [kw, nid] of wikiMap) {
        const lc = links.filter((l) => l.target === nid).length
        nodes.push({ id: nid, type: 'wiki', label: kw, linkCount: lc })
      }
    }
    if (s.showTag) {
      for (const [tag, nid] of tagMap) {
        const lc = links.filter((l) => l.target === nid).length
        nodes.push({ id: nid, type: 'tag', label: `#${tag}`, linkCount: lc })
      }
    }

    // 허브 노드 500개 초과 시 상위 linkCount 순으로 제한
    const HUB_LIMIT = 500
    const hubNodes  = nodes.filter((n) => n.type !== 'memo')
    const memoNodes = nodes.filter((n) => n.type === 'memo')

    let finalNodes: GraphNode[]
    let finalLinks = links

    if (hubNodes.length > HUB_LIMIT) {
      const topHubs = new Set(
        [...hubNodes].sort((a, b) => b.linkCount - a.linkCount)
          .slice(0, HUB_LIMIT).map((n) => n.id)
      )
      finalNodes = [...memoNodes, ...hubNodes.filter((n) => topHubs.has(n.id))]
      const allowedIds = new Set(finalNodes.map((n) => n.id))
      finalLinks = links.filter((l) => {
        const src = typeof l.source === 'string' ? l.source : l.source.id
        const tgt = typeof l.target === 'string' ? l.target : l.target.id
        return allowedIds.has(src) && allowedIds.has(tgt)
      })
    } else {
      finalNodes = nodes
    }

    setNodes(finalNodes)
    setLinks(finalLinks)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // settingsRef / rawRef (refs) + Zustand setters (안정적 참조)

  // 네트워크 페치 — 마운트·folderFilter 변경·Realtime 이벤트 시만 호출
  const fetchRawData = useCallback(async () => {
    const s = settingsRef.current
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    // 폴더 목록 로드 (GraphSettings 드롭다운용)
    supabase.from('folders').select('*').eq('user_id', user.id).order('order_index').then(({ data }) => {
      if (data) setFolders(data.map(toFolder))
    })

    let query = supabase
      .from('memos')
      .select('id, title, content_text, tags, wiki_links, is_starred, is_pinned, folder_id, created_at')
      .eq('user_id', user.id)
      .eq('is_deleted', false)

    if (s.folderFilter) {
      query = query.eq('folder_id', s.folderFilter)
    }

    const { data: memos } = await query.limit(5000)
    if (!memos) return

    let simLinks: Array<{ source: string; target: string }> = []
    try {
      const res = await fetch('/api/graph/analyze')
      if (res.ok) {
        const json = await res.json()
        simLinks = json.links ?? []
      }
    } catch { /* 분석 실패 시 무시 */ }

    rawRef.current = { memos: memos as RawMemo[], simLinks }
    buildGraph()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // settingsRef / supabase (singleton) / buildGraph (안정적 참조)

  // showIsolated / showWiki / showTag 변경 → 로컬 계산만 (네트워크 없음)
  useEffect(() => {
    buildGraph()
  }, [settings.showIsolated, settings.showWiki, settings.showTag, buildGraph])

  // folderFilter 변경 → SQL 조건이 바뀌므로 re-fetch (마운트 포함)
  useEffect(() => {
    fetchRawData()
  }, [settings.folderFilter, fetchRawData])

  // Realtime 구독 — 마운트 시 한 번만
  useEffect(() => {
    const channel = supabase
      .channel('graph-memos')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'memos' }, fetchRawData)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // supabase는 singleton, fetchRawData는 안정적 참조 — 재구독 불필요

  return { reload: fetchRawData }
}
