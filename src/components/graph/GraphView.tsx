'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import * as d3 from 'd3'
import { Search, Settings, RefreshCw, Network, X } from 'lucide-react'
import { format } from 'date-fns'
import { cn } from '@/lib/utils'
import { useGraphStore, type GraphNode, type GraphLink } from '@/store/graphStore'
import { useGraphData } from '@/hooks/useGraphData'
import GraphSettings from './GraphSettings'
import GraphTooltip from './GraphTooltip'

// 슬라이더 1~10 → D3 force 파라미터 변환
const toCharge         = (v: number) => -(v * 30)   // -30 – -300
const toDistance       = (v: number) => v * 20       // 20 – 200 px
const toCenterStrength = (v: number) => v * 0.01     // 0.01 – 0.1

// 노드 색상 계산
function nodeColor(n: GraphNode): string {
  if (n.type === 'wiki') return '#1D9E75'
  if (n.type === 'tag')  return '#378ADD'
  const c = n.linkCount
  if (c === 0)   return '#B4B2A9'
  if (c <= 2)  return '#CECBF6'
  if (c <= 4)  return '#AFA9EC'
  if (c <= 6)  return '#7F77DD'
  return '#534AB7'
}

function nodeRadius(n: GraphNode, nodeSize: number): number {
  const base = 3 + nodeSize * 1.5  // 1-10 → 4.5-18px
  if (n.type === 'wiki' || n.type === 'tag') {
    return base * 0.7 + Math.min(n.linkCount, 10) * 0.8
  }
  const c = n.linkCount
  if (c === 0) return base * 0.6
  if (c <= 2)  return base * 0.85
  if (c <= 4)  return base * 1.0
  return base * 1.4
}

// 줌 기반 라벨 투명도 계산
function getLabelOpacity(zoom: number): number {
  const FADE_START = 0.4
  const FADE_END = 0.8
  if (zoom <= FADE_START) return 0
  if (zoom >= FADE_END) return 1
  return (zoom - FADE_START) / (FADE_END - FADE_START)
}

export default function GraphView() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const highlightId = searchParams.get('highlight')

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const simRef = useRef<d3.Simulation<GraphNode, GraphLink> | null>(null)
  const rafRef = useRef<number | null>(null)
  const transformRef = useRef({ x: 0, y: 0, k: 1 })
  const labelOpacityRef = useRef(1) // 초기 zoom=1 → opacity=1
  const isFirstNodesUpdateRef = useRef(true)
  const labelAnimRafRef = useRef<number | null>(null)
  const drawRef = useRef<() => void>(() => {})
  const dragNodeRef = useRef<GraphNode | null>(null)
  const dragStartRef = useRef({ x: 0, y: 0 })
  const isDraggingRef = useRef(false)
  const canvasDragRef = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null)
  const [size, setSize] = useState({ w: 800, h: 600 })

  const { nodes, links, settings, selectedNodeId, setSelectedNode, setHighlightNode } = useGraphStore()
  const { reload } = useGraphData()
  const settingsRef = useRef(settings)
  settingsRef.current = settings  // 항상 최신값 유지

  const [simStatus, setSimStatus] = useState<'sleeping' | 'active'>('sleeping')
  const [showSettings, setShowSettings] = useState(true)
  const [search, setSearch] = useState('')
  const [searchMatches, setSearchMatches] = useState<GraphNode[]>([])
  const [searchMatchIdx, setSearchMatchIdx] = useState(0)
  const [tooltip, setTooltip] = useState<{ x: number; y: number; label: string; type: 'memo' | 'wiki' | 'tag'; linkCount: number } | null>(null)
  const [selectedTagPanel, setSelectedTagPanel] = useState<{
    tag: string
    memos: Array<{ id: string; label: string; createdAt?: string }>
  } | null>(null)

  // 캔버스 크기 추적
  useEffect(() => {
    const obs = new ResizeObserver((entries) => {
      for (const e of entries) {
        setSize({ w: Math.floor(e.contentRect.width), h: Math.floor(e.contentRect.height) })
      }
    })
    if (containerRef.current) obs.observe(containerRef.current)
    return () => obs.disconnect()
  }, [])

  // draw
  const draw = useCallback(() => {
    const t0 = performance.now()
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.save()
    ctx.scale(dpr, dpr)
    const { x, y, k } = transformRef.current

    ctx.translate(x, y)
    ctx.scale(k, k)

    const simNodes = simRef.current?.nodes() ?? []
    const simLinks = (simRef.current?.force('link') as d3.ForceLink<GraphNode, GraphLink>)?.links() ?? []
    const base = settings.nodeSize
    const lw = settings.linkWidth * 0.5  // 1-10 → 0.5-5px

    // 태그 필터 하이라이트 집합
    let tagMatchIds: Set<string> | null = null
    if (settings.tagFilter.trim()) {
      const q = settings.tagFilter.replace(/^#/, '').toLowerCase().trim()
      tagMatchIds = new Set<string>()
      for (const l of simLinks) {
        const src = l.source as GraphNode
        const tgt = l.target as GraphNode
        if (tgt.type === 'tag' && tgt.label.replace(/^#/, '').toLowerCase().includes(q)) {
          tagMatchIds.add(src.id)
          tagMatchIds.add(tgt.id)
        }
      }
    }

    // 선택 연결 집합
    const connectedSet = new Set<string>()
    if (selectedNodeId) {
      for (const l of simLinks) {
        const s = (l.source as GraphNode).id
        const t = (l.target as GraphNode).id
        if (s === selectedNodeId) connectedSet.add(t)
        if (t === selectedNodeId) connectedSet.add(s)
      }
    }

    // 링크
    for (const l of simLinks) {
      const src = l.source as GraphNode
      const tgt = l.target as GraphNode
      if (src.x == null || tgt.x == null) continue
      const sid = src.id, tid = tgt.id
      const hi = selectedNodeId && (sid === selectedNodeId || tid === selectedNodeId || connectedSet.has(sid) || connectedSet.has(tid))
      const tagLinkDim = tagMatchIds !== null && !(tagMatchIds.has(sid) && tagMatchIds.has(tid))
      const op = tagLinkDim ? 0.03 : selectedNodeId ? (hi ? 0.9 : 0.06) : 0.5
      ctx.lineWidth = lw

      if (l.type === 'wiki') {
        ctx.strokeStyle = `rgba(29,158,117,${op})`
      } else if (l.type === 'tag') {
        ctx.strokeStyle = `rgba(55,138,221,${op})`
      } else {
        ctx.strokeStyle = `rgba(127,119,221,${Math.max(op * 0.6, 0.04)})`
      }

      if (l.type !== 'similarity') {
        const dx = tgt.x! - src.x!
        const dy = tgt.y! - src.y!
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist < 1) continue
        const tr = nodeRadius(tgt, base)
        const ex = tgt.x! - (dx / dist) * tr
        const ey = tgt.y! - (dy / dist) * tr
        ctx.beginPath(); ctx.moveTo(src.x!, src.y!); ctx.lineTo(ex, ey); ctx.stroke()
        const arrow = Math.min(lw * 3.5, 9)
        const ang = Math.atan2(dy, dx)
        ctx.fillStyle = ctx.strokeStyle
        ctx.beginPath()
        ctx.moveTo(ex, ey)
        ctx.lineTo(ex - arrow * Math.cos(ang - 0.4), ey - arrow * Math.sin(ang - 0.4))
        ctx.lineTo(ex - arrow * Math.cos(ang + 0.4), ey - arrow * Math.sin(ang + 0.4))
        ctx.closePath(); ctx.fill()
      } else {
        ctx.beginPath(); ctx.moveTo(src.x!, src.y!); ctx.lineTo(tgt.x!, tgt.y!); ctx.stroke()
      }
    }

    // 노드
    for (const n of simNodes) {
      if (n.x == null) continue
      const r = nodeRadius(n, base)
      const isSelected = n.id === selectedNodeId
      const tagNodeDim = tagMatchIds !== null && !tagMatchIds.has(n.id)
      const opac = tagNodeDim ? 0.1 : selectedNodeId ? (isSelected || connectedSet.has(n.id) ? 1 : 0.18) : 1
      ctx.globalAlpha = opac

      ctx.beginPath(); ctx.arc(n.x!, n.y!, r, 0, Math.PI * 2)
      ctx.fillStyle = nodeColor(n); ctx.fill()

      if (n.type === 'wiki') { ctx.strokeStyle = '#0F6E56'; ctx.lineWidth = 1.5; ctx.stroke() }
      else if (n.type === 'tag') { ctx.strokeStyle = '#185FA5'; ctx.lineWidth = 1.5; ctx.stroke() }
      else if (n.isStarred) { ctx.strokeStyle = '#EF9F27'; ctx.lineWidth = 2; ctx.stroke() }
      else if (n.linkCount === 0) {
        ctx.setLineDash([3, 2]); ctx.strokeStyle = '#E24B4A'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([])
      }
      if (isSelected) {
        ctx.beginPath(); ctx.arc(n.x!, n.y!, r + 3, 0, Math.PI * 2)
        ctx.strokeStyle = 'rgba(124,58,237,0.85)'; ctx.lineWidth = 2; ctx.stroke()
      }

      // 줌 연동 라벨 렌더링
      {
        const baseOp = labelOpacityRef.current
        const isHub = n.type === 'wiki' || n.type === 'tag'
        const hubOp = Math.max(0.4, baseOp)
        const labelOp = (isHub ? hubOp : baseOp) * opac
        const showLabel = labelOp > 0.01

        if (showLabel) {
          ctx.globalAlpha = labelOp
          const isDark = document.documentElement.classList.contains('dark')
          ctx.fillStyle = isDark ? '#D3D1C7' : '#2C2C2A'
          const fontWeight = isHub ? '500' : '400'
          const fontSize = Math.max(10, 11 + (k - 1) * 2)
          ctx.font = `${fontWeight} ${fontSize}px sans-serif`
          ctx.textAlign = 'center'
          const lbl = n.label.length > 12 ? n.label.slice(0, 12) + '…' : n.label
          const lx = n.x!
          const ly = n.y! + r + 14
          // 텍스트 외곽선 (가독성)
          ctx.strokeStyle = isDark ? 'rgba(0,0,0,0.65)' : 'rgba(255,255,255,0.85)'
          ctx.lineWidth = 3 / k  // 화면 기준 3px 두께
          ctx.strokeText(lbl, lx, ly)
          ctx.fillText(lbl, lx, ly)
        }
      }
    }

    ctx.globalAlpha = 1
    ctx.restore()
  }, [settings, selectedNodeId])

  // drawRef 동기화 (RAF 콜백에서 항상 최신 draw 사용)
  drawRef.current = draw

  // 라벨 투명도 lerp 애니메이션 (시뮬레이션이 잠든 상태에서도 동작)
  const startLabelAnimation = useCallback(() => {
    if (labelAnimRafRef.current) return
    function tick() {
      const target = getLabelOpacity(transformRef.current.k)
      const diff = target - labelOpacityRef.current
      if (Math.abs(diff) < 0.004) {
        labelOpacityRef.current = target
        drawRef.current()
        labelAnimRafRef.current = null
        return
      }
      labelOpacityRef.current += diff * 0.12
      drawRef.current()
      labelAnimRafRef.current = requestAnimationFrame(tick)
    }
    labelAnimRafRef.current = requestAnimationFrame(tick)
  }, [])

  const wake = useCallback((energy = 0.4) => {
    const sim = simRef.current
    if (!sim) return
    sim.alpha(Math.max(sim.alpha(), energy)).restart()
    setSimStatus('active')
  }, [])

  // 시뮬레이션 인스턴스 — 마운트·size 변경 시만 재생성
  useEffect(() => {
    const s = settingsRef.current

    const sim = d3.forceSimulation<GraphNode, GraphLink>([])
      .force('link', d3.forceLink<GraphNode, GraphLink>([]).id((n) => n.id)
        .distance(toDistance(s.linkDistance))
        .strength(0.3))
      .force('charge', d3.forceManyBody<GraphNode>().strength(toCharge(s.repulsion)))
      .force('center', d3.forceCenter(size.w / 2, size.h / 2).strength(toCenterStrength(s.centerTension)))
      .force('collision', d3.forceCollide<GraphNode>(20))
      .alphaDecay(0.1)       // 0.04 → 0.1 (약 1초 안정화)
      .velocityDecay(0.55)
      .alphaMin(0.001)

    simRef.current = sim

    const tick = () => {
      drawRef.current()
      if (sim.alpha() > sim.alphaMin()) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        setSimStatus('sleeping')
        rafRef.current = null
      }
    }
    sim.on('tick', () => { if (!rafRef.current) rafRef.current = requestAnimationFrame(tick) })

    return () => {
      sim.stop()
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      if (labelAnimRafRef.current) cancelAnimationFrame(labelAnimRafRef.current)
    }
  }, [size.w, size.h])

  // nodes/links 변경 시 incremental update — 기존 위치 복사 후 조건부 alpha
  useEffect(() => {
    const sim = simRef.current
    if (!sim) return
    if (nodes.length === 0) return  // 빈 데이터 스킵

    // 기존 노드의 위치·속도·고정 정보를 새 노드 객체에 복사 (위치 보존)
    const oldNodesById = new Map(sim.nodes().map((n) => [n.id, n]))
    for (const n of nodes) {
      const old = oldNodesById.get(n.id)
      if (old) {
        n.x  = old.x
        n.y  = old.y
        n.vx = old.vx
        n.vy = old.vy
        n.fx = old.fx
        n.fy = old.fy
      }
    }

    sim.nodes(nodes)
    ;(sim.force('link') as d3.ForceLink<GraphNode, GraphLink>).links(links)

    // 첫 데이터 로드: alpha 1로 force layout 충분히 적용
    // 이후 토글/추가: alpha 0.1로 약하게 (위치 유지)
    if (isFirstNodesUpdateRef.current) {
      sim.alpha(1).restart()
      isFirstNodesUpdateRef.current = false
    } else {
      sim.alpha(0.1).restart()
    }

    // RAF가 멈춰있으면 즉시 한 프레임 그리기 (지연 방지)
    if (!rafRef.current) drawRef.current()

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSimStatus('active')
  }, [nodes, links])

  // 물리 파라미터 변경 → 시뮬레이션 force 즉시 업데이트 (재빌드 없이)
  useEffect(() => {
    const sim = simRef.current
    if (!sim) return
    ;(sim.force('link') as d3.ForceLink<GraphNode, GraphLink>)
      ?.distance(toDistance(settings.linkDistance))
    ;(sim.force('charge') as d3.ForceManyBody<GraphNode>)
      ?.strength(toCharge(settings.repulsion))
    ;(sim.force('center') as d3.ForceCenter<GraphNode>)
      ?.strength(toCenterStrength(settings.centerTension))
    wake(0.4)
  }, [settings.centerTension, settings.repulsion, settings.linkDistance, wake])

  // 시각 전용 변경 → 재그리기만
  useEffect(() => { draw() }, [settings.nodeSize, settings.linkWidth, draw])

  // highlight
  useEffect(() => {
    if (!highlightId || !simRef.current) return
    const found = simRef.current.nodes().find((n) => n.id === highlightId)
    if (!found || found.x == null) {
      setTimeout(() => {
        const f2 = simRef.current?.nodes().find((n) => n.id === highlightId)
        if (f2) animateTo(f2)
      }, 1000)
      return
    }
    setHighlightNode(highlightId)
    animateTo(found)
    const timer = setTimeout(() => setHighlightNode(null), 3000)
    return () => clearTimeout(timer)
  }, [highlightId, nodes])

  function animateTo(n: GraphNode) {
    if (n.x == null) return
    setSelectedNode(n.id)
    const targetX = size.w / 2 - n.x * transformRef.current.k
    const targetY = size.h / 2 - n.y! * transformRef.current.k
    let frame = 0
    const go = () => {
      frame++
      const t = Math.min(frame / 25, 1)
      const ease = 1 - (1 - t) ** 3
      transformRef.current.x += (targetX - transformRef.current.x) * ease * 0.25
      transformRef.current.y += (targetY - transformRef.current.y) * ease * 0.25
      draw()
      if (t < 1) requestAnimationFrame(go)
    }
    requestAnimationFrame(go)
  }

  // 캔버스 크기
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = size.w * dpr
    canvas.height = size.h * dpr
    canvas.style.width = `${size.w}px`
    canvas.style.height = `${size.h}px`
    draw()
  }, [size, draw])

  // 마우스 이벤트
  function canvasXY(e: React.MouseEvent) {
    const r = canvasRef.current!.getBoundingClientRect()
    return { mx: e.clientX - r.left, my: e.clientY - r.top }
  }

  function hitNode(mx: number, my: number): GraphNode | null {
    const { x, y, k } = transformRef.current
    const wx = (mx - x) / k, wy = (my - y) / k
    for (const n of simRef.current?.nodes() ?? []) {
      if (n.x == null) continue
      const r = nodeRadius(n, settings.nodeSize) + 4
      if ((wx - n.x) ** 2 + (wy - n.y!) ** 2 < r ** 2) return n
    }
    return null
  }

  function onMouseDown(e: React.MouseEvent) {
    const { mx, my } = canvasXY(e)
    dragStartRef.current = { x: mx, y: my }
    isDraggingRef.current = false
    const n = hitNode(mx, my)
    if (n) { dragNodeRef.current = n; wake(0.3) }
    else canvasDragRef.current = { sx: mx, sy: my, px: transformRef.current.x, py: transformRef.current.y }
    e.preventDefault()
  }

  function onMouseMove(e: React.MouseEvent) {
    const { mx, my } = canvasXY(e)
    const dx = mx - dragStartRef.current.x, dy = my - dragStartRef.current.y
    if (Math.sqrt(dx * dx + dy * dy) > 3) isDraggingRef.current = true

    if (dragNodeRef.current) {
      const { x, y, k } = transformRef.current
      dragNodeRef.current.fx = (mx - x) / k
      dragNodeRef.current.fy = (my - y) / k
      wake(0.08)
    } else if (canvasDragRef.current) {
      const { sx, sy, px, py } = canvasDragRef.current
      transformRef.current.x = px + (mx - sx)
      transformRef.current.y = py + (my - sy)
      draw()
    }

    const hn = hitNode(mx, my)
    if (hn) {
      setTooltip({ x: e.clientX, y: e.clientY, label: hn.label, type: hn.type, linkCount: hn.linkCount })
      if (canvasRef.current) canvasRef.current.style.cursor = 'pointer'
    } else {
      setTooltip(null)
      if (canvasRef.current) canvasRef.current.style.cursor = canvasDragRef.current ? 'grabbing' : 'default'
    }
  }

  function onMouseUp(e: React.MouseEvent) {
    const { mx, my } = canvasXY(e)
    const isClick = (mx - dragStartRef.current.x) ** 2 + (my - dragStartRef.current.y) ** 2 < 25

    if (isClick) {
      const n = hitNode(mx, my)
      if (n) {
        setSelectedNode(n.id === selectedNodeId ? null : n.id)
        if (n.type === 'memo') {
          setSelectedTagPanel(null)
          router.push(`/memo/${n.id}?from=graph`)
        } else if (n.type === 'tag') {
          const tagNodeId = n.id
          const sNodes = simRef.current?.nodes() ?? []
          const sLinks = (simRef.current?.force('link') as d3.ForceLink<GraphNode, GraphLink>)?.links() ?? []
          const tagMemos = sNodes.filter((node) =>
            node.type === 'memo' &&
            sLinks.some((l) => (l.source as GraphNode).id === node.id && (l.target as GraphNode).id === tagNodeId)
          )
          setSelectedTagPanel({ tag: n.label.replace(/^#/, ''), memos: tagMemos })
        } else {
          setSelectedTagPanel(null)
        }
      } else {
        setSelectedNode(null)
        setSelectedTagPanel(null)
      }
    }

    if (dragNodeRef.current) { dragNodeRef.current = null; simRef.current?.alphaTarget(0) }
    canvasDragRef.current = null
    isDraggingRef.current = false
    draw()
  }

  function onWheel(e: React.WheelEvent) {
    e.preventDefault()
    const { mx, my } = canvasXY(e)
    const { x, y, k } = transformRef.current
    const d = e.deltaY > 0 ? 0.85 : 1.18
    const nk = Math.max(0.3, Math.min(3, k * d))
    transformRef.current.x = mx - (mx - x) * (nk / k)
    transformRef.current.y = my - (my - y) * (nk / k)
    transformRef.current.k = nk
    startLabelAnimation()
    draw()
  }

  // 검색 — MemoList와 동일: 제목 + 본문 포함, 전체 결과 순환
  function handleSearch(q: string) {
    setSearch(q)
    setSearchMatchIdx(0)
    if (!q.trim()) {
      setSelectedNode(null)
      setSearchMatches([])
      return
    }
    const lq = q.toLowerCase()
    const matches = (simRef.current?.nodes() ?? []).filter((n) =>
      n.type === 'memo' &&
      (n.label.toLowerCase().includes(lq) || (n.contentText ?? '').toLowerCase().includes(lq))
    )
    setSearchMatches(matches)
    if (matches.length > 0) animateTo(matches[0])
  }

  function handleSearchNext() {
    if (searchMatches.length === 0) return
    const next = (searchMatchIdx + 1) % searchMatches.length
    setSearchMatchIdx(next)
    animateTo(searchMatches[next])
  }

  function handleSearchPrev() {
    if (searchMatches.length === 0) return
    const prev = (searchMatchIdx - 1 + searchMatches.length) % searchMatches.length
    setSearchMatchIdx(prev)
    animateTo(searchMatches[prev])
  }

  // 레이아웃 초기화
  function handleReset() {
    simRef.current?.nodes().forEach((n) => { n.fx = null; n.fy = null; n.x = undefined; n.y = undefined })
    transformRef.current = { x: 0, y: 0, k: 1 }
    wake(1)
  }

  const memoCount = nodes.filter((n) => n.type === 'memo').length
  const wikiCount = nodes.filter((n) => n.type === 'wiki').length
  const linkCount = links.length

  return (
    <div className="flex flex-col h-full bg-gray-50 dark:bg-gray-950">
      {/* 상단 바 */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex-shrink-0">
        <Network size={16} className="text-violet-500 flex-shrink-0" />
        <span className="text-sm font-semibold text-gray-700 dark:text-gray-300 mr-2">메모 그래프</span>

        {/* 검색 */}
        <div className="flex items-center gap-1 flex-1 max-w-72">
          <div className="relative flex-1">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => handleSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.shiftKey ? handleSearchPrev() : handleSearchNext()
                if (e.key === 'Escape') handleSearch('')
              }}
              placeholder="제목·본문 검색..."
              className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 outline-none focus:ring-1 focus:ring-violet-400"
            />
          </div>
          {search.trim() && (
            <div className="flex items-center gap-0.5 flex-shrink-0">
              <span className="text-xs text-gray-400 px-1 whitespace-nowrap">
                {searchMatches.length > 0
                  ? `${searchMatchIdx + 1}/${searchMatches.length}`
                  : '없음'}
              </span>
              {searchMatches.length > 1 && (
                <>
                  <button
                    onClick={handleSearchPrev}
                    className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 text-xs leading-none"
                    title="이전 결과 (Shift+Enter)"
                  >▲</button>
                  <button
                    onClick={handleSearchNext}
                    className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 text-xs leading-none"
                    title="다음 결과 (Enter)"
                  >▼</button>
                </>
              )}
            </div>
          )}
        </div>

        <button onClick={() => reload()} title="새로고침" className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
          <RefreshCw size={14} />
        </button>

        <button
          onClick={() => setShowSettings((v) => !v)}
          title="설정"
          className={cn('p-1.5 rounded-lg transition-colors', showSettings ? 'bg-violet-100 dark:bg-violet-900/40 text-violet-600' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800')}
        >
          <Settings size={14} />
        </button>
      </div>

      {/* 메인 영역 */}
      <div className="flex flex-1 min-h-0">
        {/* 태그 패널 */}
        {selectedTagPanel && (
          <div className="w-64 flex-shrink-0 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 flex flex-col overflow-hidden animate-slide-in-left">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
              <div className="min-w-0">
                <span className="text-sm font-semibold text-blue-600 dark:text-blue-400 truncate block">#{selectedTagPanel.tag}</span>
                <span className="text-xs text-gray-400">{selectedTagPanel.memos.length}개의 메모</span>
              </div>
              <button
                onClick={() => setSelectedTagPanel(null)}
                className="ml-2 flex-shrink-0 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded transition-colors"
              >
                <X size={14} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto py-1">
              {selectedTagPanel.memos.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-6">메모가 없습니다</p>
              ) : (
                selectedTagPanel.memos.map((memo) => (
                  <button
                    key={memo.id}
                    onClick={() => router.push(`/memo/${memo.id}?from=graph`)}
                    className="w-full text-left px-4 py-2.5 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors border-b border-gray-50 dark:border-gray-800/50 last:border-0"
                  >
                    <p className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">{memo.label}</p>
                    {memo.createdAt && (
                      <p className="text-xs text-gray-400 mt-0.5">{format(new Date(memo.createdAt), 'yyyy.MM.dd')}</p>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        )}

        {/* 캔버스 */}
        <div ref={containerRef} className="flex-1 relative overflow-hidden">
          <canvas
            ref={canvasRef}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
            onWheel={onWheel}
            className="block"
          />
          {/* 노드 없을 때 안내 */}
          {nodes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-sm">
              메모를 추가하면 그래프가 나타납니다
            </div>
          )}
        </div>

        {/* 설정 패널 */}
        {showSettings && <GraphSettings onReset={handleReset} />}
      </div>

      {/* 하단 상태 바 */}
      <div className="flex items-center gap-4 px-4 py-1.5 border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 text-xs text-gray-400 flex-shrink-0">
        <span className={cn('flex items-center gap-1', simStatus === 'active' ? 'text-violet-500' : 'text-gray-400')}>
          <span className={cn('w-1.5 h-1.5 rounded-full', simStatus === 'active' ? 'bg-violet-400 animate-pulse' : 'bg-gray-300 dark:bg-gray-600')} />
          {simStatus === 'active' ? '계산 중...' : '안정'}
        </span>
        <span>메모 {memoCount}</span>
        <span>위키 {wikiCount}</span>
        <span>링크 {linkCount}</span>
      </div>

      <GraphTooltip data={tooltip} />
    </div>
  )
}
