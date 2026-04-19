'use client'

import { useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useGraphStore, type GraphNode, type GraphLink } from '@/store/graphStore'
import type { Memo } from '@/types'

function toMemoNode(m: Memo & { created_at?: string }, linkCount: number): GraphNode {
  return {
    id: m.id,
    type: 'memo',
    label: m.title || '제목 없음',
    linkCount,
    isStarred: m.isStarred,
    folderId: m.folderId,
    createdAt: m.createdAt ?? (m as unknown as Record<string, string>).created_at,
  }
}

export function useGraphData() {
  const { settings, setNodes, setLinks } = useGraphStore()
  const supabase = createClient()

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    let query = supabase
      .from('memos')
      .select('id, title, content_text, tags, wiki_links, is_starred, is_pinned, folder_id, created_at')
      .eq('user_id', user.id)
      .eq('is_deleted', false)

    if (settings.folderFilter) {
      query = query.eq('folder_id', settings.folderFilter)
    }

    const { data: memos } = await query
    if (!memos) return

    const nodes: GraphNode[] = []
    const links: GraphLink[] = []
    const wikiMap = new Map<string, string>() // keyword → nodeId
    const tagMap = new Map<string, string>()   // tag → nodeId

    // 1단계: 위키/태그 허브 노드 수집
    for (const m of memos) {
      if (settings.showWiki) {
        for (const kw of (m.wiki_links ?? [])) {
          if (!wikiMap.has(kw)) {
            const nid = `wiki:${kw}`
            wikiMap.set(kw, nid)
          }
        }
      }
      if (settings.showTag) {
        for (const tag of (m.tags ?? [])) {
          if (!tagMap.has(tag)) {
            const nid = `tag:${tag}`
            tagMap.set(tag, nid)
          }
        }
      }
    }

    // 2단계: 링크 생성 (위키 + 태그)
    const memoLinkCounts = new Map<string, number>()
    for (const m of memos) {
      let count = 0
      if (settings.showWiki) {
        for (const kw of (m.wiki_links ?? [])) {
          if (wikiMap.has(kw)) {
            links.push({ source: m.id, target: wikiMap.get(kw)!, type: 'wiki' })
            count++
          }
        }
      }
      if (settings.showTag) {
        for (const tag of (m.tags ?? [])) {
          if (tagMap.has(tag)) {
            links.push({ source: m.id, target: tagMap.get(tag)!, type: 'tag' })
            count++
          }
        }
      }
      memoLinkCounts.set(m.id, count)
    }

    // 3단계: 키워드 유사도 링크 로드
    try {
      const res = await fetch('/api/graph/analyze')
      if (res.ok) {
        const { links: simLinks } = await res.json()
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
      }
    } catch { /* 분석 실패 시 무시 */ }

    // 4단계: 메모 노드 생성 (고립 필터)
    for (const m of memos) {
      const lc = memoLinkCounts.get(m.id) ?? 0
      if (!settings.showIsolated && lc === 0) continue
      nodes.push(toMemoNode(m as unknown as Memo & { wiki_links: string[] }, lc))
    }

    // 5단계: 위키/태그 허브 노드 생성
    if (settings.showWiki) {
      for (const [kw, nid] of wikiMap) {
        const lc = links.filter((l) => l.target === nid).length
        nodes.push({ id: nid, type: 'wiki', label: kw, linkCount: lc })
      }
    }
    if (settings.showTag) {
      for (const [tag, nid] of tagMap) {
        const lc = links.filter((l) => l.target === nid).length
        nodes.push({ id: nid, type: 'tag', label: `#${tag}`, linkCount: lc })
      }
    }

    // 성능 최적화: 300개 초과 시 상위 150개
    if (nodes.length > 300) {
      const sorted = [...nodes].sort((a, b) => b.linkCount - a.linkCount)
      const top = new Set(sorted.slice(0, 150).map((n) => n.id))
      const filtered = nodes.filter((n) => top.has(n.id))
      const filteredLinks = links.filter((l) => {
        const s = typeof l.source === 'string' ? l.source : l.source.id
        const t = typeof l.target === 'string' ? l.target : l.target.id
        return top.has(s) && top.has(t)
      })
      setNodes(filtered)
      setLinks(filteredLinks)
    } else {
      setNodes(nodes)
      setLinks(links)
    }
  }, [settings.showIsolated, settings.showWiki, settings.showTag, settings.folderFilter])

  useEffect(() => { load() }, [load])

  // Supabase Realtime 구독
  useEffect(() => {
    const channel = supabase
      .channel('graph-memos')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'memos' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [load])

  return { reload: load }
}
