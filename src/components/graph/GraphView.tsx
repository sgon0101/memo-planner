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
import { Drawer } from 'vaul'

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

function nodeRadius(n: GraphNode, nodeSize: number, isMobile = false): number {
  const mobileScale = isMobile ? 0.7 : 1
  const base = (3 + nodeSize * 1.5) * mobileScale  // 1-10 → 4.5-18px
  if (n.type === 'wiki' || n.type === 'tag') {
    return base * 0.7 + Math.min(n.linkCount, 10) * 0.8 * mobileScale
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
  const isMobileRef = useRef(false)
  const pinchRef = useRef<{
    startDist: number
    startK: number
    centerX: number
    centerY: number
    startTransformX: number
    startTransformY: number
  } | null>(null)
  const lastPinchEndAtRef = useRef(0)
  const lastTouchEndAtRef = useRef(0)   // synthetic mouse event 차단용 (touchend 후 ~300ms)
  const labelAnimRafRef = useRef<number | null>(null)
  const drawRef = useRef<() => void>(() => {})
  const dragNodeRef = useRef<GraphNode | null>(null)
  const dragStartRef = useRef({ x: 0, y: 0 })
  const isDraggingRef = useRef(false)
  const canvasDragRef = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null)
  const [size, setSize] = useState({ w: 800, h: 600 })

  const { nodes, links, settings, selectedNodeId, setSelectedNode, setHighlightNode, resetSettings } = useGraphStore()
  const { reload } = useGraphData()
  const settingsRef = useRef(settings)
  settingsRef.current = settings  // 항상 최신값 유지

  const [simStatus, setSimStatus] = useState<'sleeping' | 'active'>('sleeping')
  const [showSettings, setShowSettings] = useState(() => {
    if (typeof window === 'undefined') return true
    return window.matchMedia('(min-width: 768px)').matches
  })
  const [search, setSearch] = useState('')
  const [searchMatches, setSearchMatches] = useState<GraphNode[]>([])
  const [searchMatchIdx, setSearchMatchIdx] = useState(0)
  const [tooltip, setTooltip] = useState<{ x: number; y: number; label: string; type: 'memo' | 'wiki' | 'tag'; linkCount: number } | null>(null)
  const [selectedTagPanel, setSelectedTagPanel] = useState<{
    tag: string
    memos: Array<{ id: string; label: string; createdAt?: string }>
  } | null>(null)
  const [isMobile, setIsMobile] = useState(false)

  // 모바일 감지
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const check = () => { setIsMobile(mq.matches); isMobileRef.current = mq.matches }
    check()
    mq.addEventListener('change', check)
    return () => mq.removeEventListener('change', check)
  }, [])

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
    const isMobile = isMobileRef.current
    const base = settings.nodeSize  // nodeRadius 내부에서 0.7배 적용
    const lw = settings.linkWidth * 0.5 * (isMobile ? 0.7 : 1)  // 1-10 → 0.5-5px

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
      const r = nodeRadius(n, base, isMobile)
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
          const fontSize = Math.max(isMobile ? 8 : 10, (isMobile ? 9 : 11) + (k - 1) * 2)
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
        for (const n of sim.nodes()) {
          if ((n.type === 'wiki' || n.type === 'tag') && n.x != null && n.y != null) {
            n.fx = n.x
            n.fy = n.y
          }
        }
        setSimStatus('sleeping')
        rafRef.current = null
      }
    }
    sim.on('tick', () => { if (!rafRef.current) rafRef.current = requestAnimationFrame(tick) })

    return () => {
      sim.stop()
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = null  // 재생성 시 새 시뮬레이션의 RAF 루프가 정상 시작되도록 초기화
      if (labelAnimRafRef.current) cancelAnimationFrame(labelAnimRafRef.current)
    }
  }, [size.w, size.h])

  // nodes/links 변경 시 incremental update — 기존 위치 복사 후 조건부 alpha
  useEffect(() => {
    const sim = simRef.current
    if (!sim) return
    if (nodes.length === 0) return  // 빈 데이터 스킵

    // size state가 아직 초기값(800×600)일 수 있으므로 DOM에서 직접 읽음
    const actualW = containerRef.current?.clientWidth  || size.w
    const actualH = containerRef.current?.clientHeight || size.h
    const cx = actualW / 2
    const cy = actualH / 2

    const oldNodesById = new Map(sim.nodes().map((n) => [n.id, n]))

    // 시뮬레이션이 비어있으면 (size 변경 등으로 재생성) 첫 진입과 동일하게 처리
    const isVirtuallyFirst = oldNodesById.size === 0
    const isFirst = isFirstNodesUpdateRef.current || isVirtuallyFirst

    // 기존 노드들의 영역 계산 (토글 켜기 시 새 노드 배치용)
    let oldMinX = Infinity, oldMaxX = -Infinity
    let oldMinY = Infinity, oldMaxY = -Infinity
    let validOldCount = 0
    for (const old of oldNodesById.values()) {
      if (old.x != null && old.y != null) {
        oldMinX = Math.min(oldMinX, old.x)
        oldMaxX = Math.max(oldMaxX, old.x)
        oldMinY = Math.min(oldMinY, old.y)
        oldMaxY = Math.max(oldMaxY, old.y)
        validOldCount++
      }
    }
    const oldWidth  = oldMaxX - oldMinX
    const oldHeight = oldMaxY - oldMinY
    const hasValidOldArea = validOldCount > 10 && oldWidth > 100 && oldHeight > 100

    let hasNewNodes = false

    for (const n of nodes) {
      const old = oldNodesById.get(n.id)
      if (old) {
        n.x  = old.x
        n.y  = old.y
        n.vx = old.vx
        n.vy = old.vy
        n.fx = old.fx
        n.fy = old.fy
      } else {
        if (isFirst) {
          // 첫 진입 또는 시뮬레이션 빈 상태: 화면 가득 직사각형 분산
          n.x = cx + (Math.random() - 0.5) * actualW * 0.9
          n.y = cy + (Math.random() - 0.5) * actualH * 0.9
        } else if (hasValidOldArea) {
          // 토글 켜기: 기존 노드 영역 안에 균등 분산 (자연스러운 등장)
          n.x = oldMinX + oldWidth  * 0.05 + Math.random() * oldWidth  * 0.9
          n.y = oldMinY + oldHeight * 0.05 + Math.random() * oldHeight * 0.9
        } else {
          // fallback: 기존 영역 부족 시 화면 가득 분산
          n.x = cx + (Math.random() - 0.5) * actualW * 0.85
          n.y = cy + (Math.random() - 0.5) * actualH * 0.85
        }
        hasNewNodes = true
      }
    }

    sim.nodes(nodes)
    ;(sim.force('link') as d3.ForceLink<GraphNode, GraphLink>).links(links)

    // forceCenter 일시 약화 (분산 배치된 노드를 중앙으로 끌어당기지 않도록)
    const centerForce = sim.force('center') as d3.ForceCenter<GraphNode> | null
    const normalCenterStrength = toCenterStrength(settingsRef.current.centerTension)

    if (isFirst) {
      // 첫 진입 또는 시뮬레이션 빈 상태: 강하게
      centerForce?.strength(0.001)
      sim.alpha(1).restart()
      isFirstNodesUpdateRef.current = false
      setTimeout(() => {
        const cf = simRef.current?.force('center') as d3.ForceCenter<GraphNode> | undefined
        cf?.strength(toCenterStrength(settingsRef.current.centerTension))
      }, 800)
    } else if (hasNewNodes) {
      // 기존 노드 + 새 노드 추가 (진짜 토글 켜기)
      centerForce?.strength(normalCenterStrength * 0.1)
      sim.alpha(0.8).restart()
      setTimeout(() => {
        const cf = simRef.current?.force('center') as d3.ForceCenter<GraphNode> | undefined
        cf?.strength(toCenterStrength(settingsRef.current.centerTension))
      }, 1200)
    } else {
      // 노드 추가 없음 (토글 끄기, 링크만 변경)
      sim.alpha(0.1).restart()
    }

    // 항상 즉시 draw (RAF 상태 무관)
    drawRef.current()

    // RAF 멈춰있으면 강제로 시작 (sim.tick 이벤트 기다리지 않음)
    if (!rafRef.current && sim.alpha() > sim.alphaMin()) {
      const tick = () => {
        drawRef.current()
        if (sim.alpha() > sim.alphaMin()) {
          rafRef.current = requestAnimationFrame(tick)
        } else {
          for (const n of sim.nodes()) {
            if ((n.type === 'wiki' || n.type === 'tag') && n.x != null && n.y != null) {
              n.fx = n.x
              n.fy = n.y
            }
          }
          setSimStatus('sleeping')
          rafRef.current = null
        }
      }
      rafRef.current = requestAnimationFrame(tick)
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSimStatus('active')

  }, [nodes, links, size.w, size.h])

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

  // 노드 선택 변경 시 흐림 효과 즉시 그리기 (위키는 페이지 이동/패널 없어 자동 draw 필요)
  useEffect(() => { drawRef.current() }, [selectedNodeId])

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
    // 실제 렌더 크기로 중심 계산 (size state의 stale closure 방지)
    const w = containerRef.current?.clientWidth ?? size.w
    const h = containerRef.current?.clientHeight ?? size.h
    const targetX = w / 2 - n.x * transformRef.current.k
    const targetY = h / 2 - n.y! * transformRef.current.k
    const startX = transformRef.current.x
    const startY = transformRef.current.y
    let frame = 0
    const FRAMES = 30
    const go = () => {
      frame++
      const t = Math.min(frame / FRAMES, 1)
      const ease = 1 - (1 - t) ** 3  // cubic ease-out: t=1이면 ease=1 → 목표 지점 정확히 도달
      transformRef.current.x = startX + (targetX - startX) * ease
      transformRef.current.y = startY + (targetY - startY) * ease
      drawRef.current()  // draw() 직접 호출 시 selectedNodeId 반영 전 OLD 클로저 사용 → drawRef로 교체
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

  function touchXY(e: React.TouchEvent, touchIndex = 0) {
    const r = canvasRef.current!.getBoundingClientRect()
    const t = e.touches[touchIndex] || e.changedTouches[touchIndex]
    return { mx: t.clientX - r.left, my: t.clientY - r.top }
  }

  function pinchInfo(e: React.TouchEvent) {
    const r = canvasRef.current!.getBoundingClientRect()
    const t1 = e.touches[0], t2 = e.touches[1]
    const dx = t2.clientX - t1.clientX, dy = t2.clientY - t1.clientY
    return {
      dist: Math.sqrt(dx * dx + dy * dy),
      cx: (t1.clientX + t2.clientX) / 2 - r.left,
      cy: (t1.clientY + t2.clientY) / 2 - r.top,
    }
  }

  function hitNode(mx: number, my: number): GraphNode | null {
    const { x, y, k } = transformRef.current
    const wx = (mx - x) / k, wy = (my - y) / k
    const mob = isMobileRef.current
    // 화면 기준 최소 클릭 반지름 (줌 보정으로 항상 일정 크기 보장)
    const minHitWorld = (mob ? 26 : 14) / k
    const visualPad = mob ? 10 : 6
    for (const n of simRef.current?.nodes() ?? []) {
      if (n.x == null) continue
      const visualR = nodeRadius(n, settings.nodeSize, mob)
      // 허브 노드(위키/태그)는 force 영향 커서 위치 변동 큼 → 모바일에서 추가 패딩
      const extraPad = (n.type === 'wiki' || n.type === 'tag') && mob ? 6 : 0
      const hitR = Math.max(visualR + visualPad + extraPad, minHitWorld)
      if ((wx - n.x) ** 2 + (wy - n.y!) ** 2 < hitR ** 2) return n
    }
    return null
  }

  function onMouseDown(e: React.MouseEvent) {
    // touchend 후 발화되는 synthetic mousedown 차단 (이중 토글 → dim 즉시 해제 방지)
    if (e.type === 'mousedown' && Date.now() - lastTouchEndAtRef.current < 600) return
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
    if (Math.sqrt(dx * dx + dy * dy) > 5) isDraggingRef.current = true

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
    // touchend 후 발화되는 synthetic mouseup 차단 (delegated 터치 호출은 e.type 없음)
    if (e.type === 'mouseup' && Date.now() - lastTouchEndAtRef.current < 600) return
    const { mx, my } = canvasXY(e)
    const wasOnNode = dragNodeRef.current !== null
    const isClick = wasOnNode
      ? !isDraggingRef.current
      : (mx - dragStartRef.current.x) ** 2 + (my - dragStartRef.current.y) ** 2 < 25

    if (isClick) {
      const clickedNode = dragNodeRef.current ?? hitNode(mx, my)

      if (search.trim()) {
        // 검색 중: 노드 클릭 → 해당 메모로 즉시 이동 (검색 상태 유지)
        //           빈 공간 클릭 → 검색 초기화
        if (clickedNode?.type === 'memo') {
          router.push(`/memo/${clickedNode.id}?from=graph`)
        } else if (!clickedNode) {
          handleSearch('')
          setSelectedNode(null)
          setSelectedTagPanel(null)
        }
      } else if (selectedNodeId) {
        // 검색 없음 + 선택 중: 첫 탭은 선택 해제
        setSelectedNode(null)
        setSelectedTagPanel(null)
      } else {
        // 검색 없음 + 선택 없음: 노드 활성화
        if (clickedNode) {
          setSelectedNode(clickedNode.id)
          if (clickedNode.type === 'memo') {
            setSelectedTagPanel(null)
            router.push(`/memo/${clickedNode.id}?from=graph`)
          } else if (clickedNode.type === 'tag') {
            const tagNodeId = clickedNode.id
            const sNodes = simRef.current?.nodes() ?? []
            const sLinks = (simRef.current?.force('link') as d3.ForceLink<GraphNode, GraphLink>)?.links() ?? []
            const tagMemos = sNodes.filter((node) =>
              node.type === 'memo' &&
              sLinks.some((l) => (l.source as GraphNode).id === node.id && (l.target as GraphNode).id === tagNodeId)
            )
            setSelectedTagPanel({ tag: clickedNode.label.replace(/^#/, ''), memos: tagMemos })
          } else {
            setSelectedTagPanel(null)
          }
        } else {
          setSelectedNode(null)
          setSelectedTagPanel(null)
        }
      }
    }

    if (dragNodeRef.current) { dragNodeRef.current = null; simRef.current?.alphaTarget(0) }
    canvasDragRef.current = null
    isDraggingRef.current = false
    draw()
  }

  // 터치 이벤트 — 한 손가락: 마우스 위임 / 두 손가락: 핀치 줌
  function onTouchStart(e: React.TouchEvent) {
    if (e.touches.length === 2) {
      e.preventDefault()
      const { dist, cx, cy } = pinchInfo(e)
      pinchRef.current = {
        startDist: dist,
        startK: transformRef.current.k,
        centerX: cx,
        centerY: cy,
        startTransformX: transformRef.current.x,
        startTransformY: transformRef.current.y,
      }
      if (dragNodeRef.current) { dragNodeRef.current = null; simRef.current?.alphaTarget(0) }
      canvasDragRef.current = null
      isDraggingRef.current = false
      return
    }
    if (e.touches.length !== 1) return
    e.preventDefault()
    const t = e.touches[0]
    onMouseDown({ clientX: t.clientX, clientY: t.clientY, preventDefault: () => {} } as unknown as React.MouseEvent)
  }

  function onTouchMove(e: React.TouchEvent) {
    if (e.touches.length === 2 && pinchRef.current) {
      e.preventDefault()
      const { dist, cx, cy } = pinchInfo(e)
      const p = pinchRef.current
      const newK = Math.max(0.08, Math.min(3, p.startK * (dist / p.startDist)))
      const worldX = (p.centerX - p.startTransformX) / p.startK
      const worldY = (p.centerY - p.startTransformY) / p.startK
      transformRef.current.k = newK
      transformRef.current.x = cx - worldX * newK
      transformRef.current.y = cy - worldY * newK
      startLabelAnimation()
      draw()
      return
    }
    if (e.touches.length !== 1) return
    e.preventDefault()
    const r2 = canvasRef.current!.getBoundingClientRect()
    const t = e.touches[0]
    const mx = t.clientX - r2.left
    const my = t.clientY - r2.top
    const dx = mx - dragStartRef.current.x
    const dy = my - dragStartRef.current.y
    const dist = Math.sqrt(dx * dx + dy * dy)

    if (dragNodeRef.current) {
      // 노드 드래그: 5px 임계값 (정밀한 이동 필요)
      if (dist > 5) isDraggingRef.current = true
      if (isDraggingRef.current) {
        const { x, y, k } = transformRef.current
        dragNodeRef.current.fx = (mx - x) / k
        dragNodeRef.current.fy = (my - y) / k
        wake(0.08)
      }
    } else if (canvasDragRef.current) {
      // 캔버스 패닝: 15px 임계값 (탭 중 손가락 지터 방지)
      if (dist > 15) isDraggingRef.current = true
      if (isDraggingRef.current) {
        const { sx, sy, px, py } = canvasDragRef.current
        transformRef.current.x = px + (mx - sx)
        transformRef.current.y = py + (my - sy)
        draw()
      }
    }
  }

  function onTouchEnd(e: React.TouchEvent) {
    lastTouchEndAtRef.current = Date.now()  // synthetic mouse event 차단 타이머 리셋
    // 핀치 중이었다가 손가락 하나라도 떼면 핀치 종료
    if (pinchRef.current && e.touches.length < 2) {
      pinchRef.current = null
      lastPinchEndAtRef.current = Date.now()
      if (e.touches.length === 1) {
        isDraggingRef.current = true
        return
      }
      isDraggingRef.current = false
      return
    }

    if (e.touches.length > 0) return

    // 최근 핀치 직후 200ms 이내면 클릭 차단
    if (Date.now() - lastPinchEndAtRef.current < 200) {
      if (dragNodeRef.current) { dragNodeRef.current = null; simRef.current?.alphaTarget(0) }
      canvasDragRef.current = null
      isDraggingRef.current = false
      return
    }

    const t = e.changedTouches[0]
    if (!t) return
    const r = canvasRef.current!.getBoundingClientRect()
    const ex = t.clientX - r.left
    const ey = t.clientY - r.top

    // 터치 거리로 탭 직접 판단 — isDraggingRef는 5px 기준이라 탭도 막을 수 있음
    const tapDist = Math.sqrt((ex - dragStartRef.current.x) ** 2 + (ey - dragStartRef.current.y) ** 2)

    if (tapDist < 12) {
      // 탭: isDraggingRef 리셋 후 onMouseUp 위임 (isClick 판정 정상화)
      isDraggingRef.current = false
      onMouseUp({ clientX: t.clientX, clientY: t.clientY } as React.MouseEvent)
    } else {
      // 패닝/드래그: 정리만
      if (dragNodeRef.current) { dragNodeRef.current = null; simRef.current?.alphaTarget(0) }
      canvasDragRef.current = null
      isDraggingRef.current = false
      draw()
    }
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

  // 레이아웃 초기화 (설정 + 위치 + 줌 모두 리셋)
  function handleReset() {
    const sim = simRef.current
    if (!sim) return

    // 1. 슬라이더/토글/필터 모두 기본값으로
    resetSettings()

    // 2. 줌/팬 리셋
    transformRef.current = { x: 0, y: 0, k: 1 }

    // 3. 화면 크기 측정 (DOM 직접 읽기)
    const actualW = containerRef.current?.clientWidth || size.w
    const actualH = containerRef.current?.clientHeight || size.h
    const cx = actualW / 2
    const cy = actualH / 2

    // 4. 모든 노드 좌표를 화면 가득 직사각형 분산 (undefined 아님 → draw 스킵 방지)
    sim.nodes().forEach((n) => {
      n.fx = null
      n.fy = null
      n.vx = 0
      n.vy = 0
      n.x = cx + (Math.random() - 0.5) * actualW * 0.9
      n.y = cy + (Math.random() - 0.5) * actualH * 0.9
    })

    // 5. forceCenter 일시 약화 (중앙 뭉침 방지)
    const centerForce = sim.force('center') as d3.ForceCenter<GraphNode> | null
    centerForce?.strength(0.001)
    setTimeout(() => {
      const cf = simRef.current?.force('center') as d3.ForceCenter<GraphNode> | undefined
      cf?.strength(toCenterStrength(settingsRef.current.centerTension))
    }, 800)

    // 6. isFirst true (다음 nodes/links 변경 시 첫 진입 분기로)
    isFirstNodesUpdateRef.current = true

    // 7. 시뮬레이션 alpha 1로 강하게 재시작
    sim.alpha(1).restart()
    setSimStatus('active')

    // 8. 즉시 한 프레임 그리기
    drawRef.current()

    // 9. RAF 시작
    if (!rafRef.current) {
      const tick = () => {
        drawRef.current()
        if (sim.alpha() > sim.alphaMin()) {
          rafRef.current = requestAnimationFrame(tick)
        } else {
          for (const n of sim.nodes()) {
            if ((n.type === 'wiki' || n.type === 'tag') && n.x != null && n.y != null) {
              n.fx = n.x
              n.fy = n.y
            }
          }
          setSimStatus('sleeping')
          rafRef.current = null
        }
      }
      rafRef.current = requestAnimationFrame(tick)
    }
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
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
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
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            onTouchCancel={onTouchEnd}
            className="block touch-none"
          />
          {/* 노드 없을 때 안내 */}
          {nodes.length === 0 && (
            <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-sm">
              메모를 추가하면 그래프가 나타납니다
            </div>
          )}
        </div>

        {/* 데스크톱: 사이드 패널 (기존) */}
        <div className="hidden md:contents">
          {showSettings && <GraphSettings onReset={handleReset} />}
        </div>

        {/* 모바일: Bottom Sheet (isMobile일 때만 마운트) */}
        {isMobile && (
          <Drawer.Root
            open={showSettings}
            onOpenChange={setShowSettings}
            shouldScaleBackground={false}
          >
            <Drawer.Portal>
              <Drawer.Overlay className="fixed inset-0 bg-black/40 z-40" />
              <Drawer.Content className="fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-gray-900 rounded-t-2xl shadow-2xl flex flex-col max-h-[85vh] outline-none">
                <div className="flex-shrink-0 mx-auto w-12 h-1.5 bg-gray-300 dark:bg-gray-600 rounded-full mt-3 mb-2" />
                <Drawer.Title className="sr-only">그래프 설정</Drawer.Title>
                <div className="flex-1 overflow-y-auto pb-safe">
                  <GraphSettings onReset={() => { handleReset(); setShowSettings(false) }} />
                </div>
              </Drawer.Content>
            </Drawer.Portal>
          </Drawer.Root>
        )}
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
