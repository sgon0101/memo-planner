'use client'

import { useEffect, useLayoutEffect, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useGraphStore, type GraphNode, type GraphLink } from '@/store/graphStore'
import { useFolderStore } from '@/store/folderStore'
import type { Memo, Folder } from '@/types'

const ANALYZE_CACHE_KEY    = 'graph-analyze-cache-v1'
const ANALYZE_CACHE_TS_KEY = 'graph-analyze-cache-ts-v1'
const ANALYZE_CACHE_TTL_MS = 5 * 60 * 1000  // 5분

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
    console.log('🔵 [1] buildGraph START', new Date().toISOString())
    const t0 = performance.now()

    if (!rawRef.current) {
      console.log('🔵 [2] no rawRef, return')
      return
    }
    const s = settingsRef.current
    console.log('🔵 [3] settings:', {
      showWiki: s.showWiki,
      showTag: s.showTag,
      showIsolated: s.showIsolated,
      folderFilter: s.folderFilter
    })

    const { memos, simLinks } = rawRef.current
    console.log('🔵 [4] rawData:', { memos: memos.length, simLinks: simLinks.length })

    const nodes: GraphNode[] = []
    const links: GraphLink[] = []
    const wikiMap = new Map<string, string>()
    const tagMap = new Map<string, string>()

    const tStage1 = performance.now()
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
    console.log('🔵 [5] stage1 (hub collect):', (performance.now() - tStage1).toFixed(1), 'ms')


    const tStage2 = performance.now()
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
    console.log('🔵 [6] stage2 (links):', (performance.now() - tStage2).toFixed(1), 'ms', 'links:', links.length)

    const tStage3 = performance.now()
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
    console.log('🔵 [7] stage3 (similarity):', (performance.now() - tStage3).toFixed(1), 'ms')

    const tStage4 = performance.now()
    // 4단계: 메모 노드 생성 (고립 필터)
    for (const m of memos) {
      const lc = memoLinkCounts.get(m.id) ?? 0
      if (!s.showIsolated && lc === 0) continue
      nodes.push(toMemoNode(m as unknown as Memo & { wiki_links: string[] }, lc))
    }
    console.log('🔵 [8] stage4 (memo nodes):', (performance.now() - tStage4).toFixed(1), 'ms', 'nodes:', nodes.length)

    const tStage5 = performance.now()
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
    console.log('🔵 [9] stage5 (hub nodes):', (performance.now() - tStage5).toFixed(1), 'ms', 'totalNodes:', nodes.length)

    const tStage6 = performance.now()
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
    console.log('🔵 [10] stage6 (hub limit):', (performance.now() - tStage6).toFixed(1), 'ms')
    console.log('🔵 [11] finalNodes:', finalNodes.length, 'finalLinks:', finalLinks.length)

    // 임시 디버그 — 화면 우측 상단 표시
    if (typeof document !== 'undefined') {
      let debugDiv = document.getElementById('graph-debug')
      if (!debugDiv) {
        debugDiv = document.createElement('div')
        debugDiv.id = 'graph-debug'
        debugDiv.style.cssText = 'position:fixed;top:60px;right:10px;background:rgba(0,0,0,0.8);color:lime;padding:10px;font-family:monospace;font-size:11px;z-index:9999;max-width:300px;border-radius:4px;line-height:1.4;'
        document.body.appendChild(debugDiv)
      }
      const totalMs = (performance.now() - t0).toFixed(0)
      debugDiv.innerHTML = `
        <div>buildGraph: ${totalMs}ms</div>
        <div>nodes: ${finalNodes.length}</div>
        <div>links: ${finalLinks.length}</div>
        <div>time: ${new Date().toLocaleTimeString()}</div>
      `
    }

    const tSetState = performance.now()
    setNodes(finalNodes)
    setLinks(finalLinks)
    console.log('🔵 [12] setState:', (performance.now() - tSetState).toFixed(1), 'ms')

    console.log('🔵 [13] buildGraph TOTAL:', (performance.now() - t0).toFixed(1), 'ms')
    console.log('───────────────────────────────────────────')
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // settingsRef / rawRef (refs) + Zustand setters (안정적 참조)

  // 네트워크 페치 — 마운트·folderFilter 변경·Realtime 이벤트 시만 호출
  const fetchRawData = useCallback(async () => {
    console.log('🔴 [N1] fetchRawData START', new Date().toISOString())
    const tFetchStart = performance.now()

    const s = settingsRef.current
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      console.log('🔴 [N2] no user, abort')
      return
    }
    console.log('🔴 [N3] auth:', (performance.now() - tFetchStart).toFixed(1), 'ms')

    // 폴더 목록 로드 (GraphSettings 드롭다운용)
    supabase.from('folders').select('*').eq('user_id', user.id).order('order_index').then(({ data }) => {
      if (data) setFolders(data.map(toFolder))
    })

    const tQuery = performance.now()
    let query = supabase
      .from('memos')
      .select('id, title, content_text, tags, wiki_links, is_starred, is_pinned, folder_id, created_at')
      .eq('user_id', user.id)
      .eq('is_deleted', false)

    if (s.folderFilter) {
      query = query.eq('folder_id', s.folderFilter)
    }

    const { data: memos } = await query.limit(5000)
    console.log('🔴 [N4] memos query:', (performance.now() - tQuery).toFixed(1), 'ms', 'count:', memos?.length)

    if (!memos) return

    // 1) sessionStorage 캐시 확인
    let simLinks: Array<{ source: string; target: string }> = []
    try {
      const cached   = sessionStorage.getItem(ANALYZE_CACHE_KEY)
      const cachedTs = sessionStorage.getItem(ANALYZE_CACHE_TS_KEY)
      if (cached && cachedTs) {
        const age = Date.now() - parseInt(cachedTs)
        if (age < ANALYZE_CACHE_TTL_MS) {
          simLinks = JSON.parse(cached)
          console.log('🟢 analyze cache HIT, age:', Math.round(age / 1000), 's')
        }
      }
    } catch { /* 캐시 파싱 실패 시 무시 */ }

    // 2) 캐시 있으면 즉시, 없으면 빈 simLinks로 먼저 그래프 표시
    rawRef.current = { memos: memos as RawMemo[], simLinks }
    console.log('🔴 [N6] fetchRawData TOTAL:', (performance.now() - tFetchStart).toFixed(1), 'ms')
    console.log('🔴 [N7] → calling buildGraph')
    buildGraph()

    // 3) 캐시 없을 때 백그라운드에서 analyze 호출
    if (simLinks.length === 0) {
      console.log('🔴 analyze cache MISS, fetching in background...')
      fetch('/api/graph/analyze')
        .then((res) => res.ok ? res.json() : { links: [] })
        .then((json) => {
          const newSimLinks: Array<{ source: string; target: string }> = json.links ?? []
          try {
            sessionStorage.setItem(ANALYZE_CACHE_KEY, JSON.stringify(newSimLinks))
            sessionStorage.setItem(ANALYZE_CACHE_TS_KEY, String(Date.now()))
          } catch { /* 저장 실패 시 무시 */ }
          if (rawRef.current) {
            rawRef.current.simLinks = newSimLinks
            buildGraph()
          }
        })
        .catch(() => { /* 분석 실패 시 무시 */ })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // settingsRef / supabase (singleton) / buildGraph (안정적 참조)

  // showIsolated / showWiki / showTag 변경 → 페인트 전에 동기 반영
  useLayoutEffect(() => {
    console.log('🟡 [T] settings toggle detected:', new Date().toISOString())
    const tTrigger = performance.now()
    buildGraph()
    console.log('🟡 [T2] toggle → buildGraph dispatched:', (performance.now() - tTrigger).toFixed(1), 'ms')
  }, [settings.showIsolated, settings.showWiki, settings.showTag, buildGraph])

  // folderFilter 변경 → SQL 조건이 바뀌므로 re-fetch (마운트 포함)
  useEffect(() => {
    console.log('🟠 [F] folderFilter trigger / mount:', new Date().toISOString())
    fetchRawData()
  }, [settings.folderFilter, fetchRawData])

  // Realtime 구독 — 마운트 시 한 번만
  useEffect(() => {
    const channel = supabase
      .channel('graph-memos')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'memos' }, () => {
        console.log('⚡ [R] Realtime event triggered, calling fetchRawData')
        fetchRawData()
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // supabase는 singleton, fetchRawData는 안정적 참조 — 재구독 불필요

  return { reload: fetchRawData }
}