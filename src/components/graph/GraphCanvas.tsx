'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import * as d3 from 'd3'
import { useGraphStore, type GraphNode, type GraphLink } from '@/store/graphStore'

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

// 노드 반지름
function nodeRadius(n: GraphNode, base: number): number {
  if (n.type === 'wiki' || n.type === 'tag') {
    const s = Math.min(n.linkCount, 10)
    return base * 0.7 + s * 0.8
  }
  const c = n.linkCount
  if (c === 0)  return base * 0.6
  if (c <= 2) return base * 0.85
  if (c <= 4) return base * 1.0
  return base * 1.4
}

interface Props {
  width: number
  height: number
}

export default function GraphCanvas({ width, height }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const simRef = useRef<d3.Simulation<GraphNode, GraphLink> | null>(null)
  const rafRef = useRef<number | null>(null)
  const transformRef = useRef({ x: 0, y: 0, k: 1 })
  const isDraggingRef = useRef(false)
  const dragNodeRef = useRef<GraphNode | null>(null)
  const dragStartRef = useRef({ x: 0, y: 0 })
  const canvasDragRef = useRef<{ startX: number; startY: number; panX: number; panY: number } | null>(null)

  const { nodes, links, settings, selectedNodeId, highlightNodeId, setSelectedNode } = useGraphStore()
  const [, setSimStatus] = useState<'sleeping' | 'active'>('sleeping')

  // 캔버스 그리기
  const draw = useCallback(() => {
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
    const lw = settings.linkWidth

    // 연결된 노드 집합
    const connectedToSelected = new Set<string>()
    if (selectedNodeId) {
      for (const l of simLinks) {
        const s = typeof l.source === 'object' ? (l.source as GraphNode).id : l.source as string
        const t = typeof l.target === 'object' ? (l.target as GraphNode).id : l.target as string
        if (s === selectedNodeId) connectedToSelected.add(t)
        if (t === selectedNodeId) connectedToSelected.add(s)
      }
    }

    // 링크 그리기
    for (const l of simLinks) {
      const src = l.source as GraphNode
      const tgt = l.target as GraphNode
      if (src.x == null || tgt.x == null) continue

      const srcId = src.id
      const tgtId = tgt.id
      const isHighlighted = selectedNodeId && (
        srcId === selectedNodeId || tgtId === selectedNodeId ||
        connectedToSelected.has(srcId) || connectedToSelected.has(tgtId)
      )
      const opacity = selectedNodeId ? (isHighlighted ? 0.9 : 0.06) : 0.5

      ctx.beginPath()
      ctx.lineWidth = lw

      if (l.type === 'wiki') {
        ctx.strokeStyle = `rgba(29,158,117,${opacity})`
      } else if (l.type === 'tag') {
        ctx.strokeStyle = `rgba(55,138,221,${opacity})`
      } else {
        ctx.strokeStyle = `rgba(127,119,221,${Math.max(opacity * 0.6, 0.05)})`
      }

      ctx.moveTo(src.x!, src.y!)

      if (l.type === 'wiki' || l.type === 'tag') {
        // 화살표
        const dx = tgt.x! - src.x!
        const dy = tgt.y! - src.y!
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist < 1) continue
        const tgtR = nodeRadius(tgt, base)
        const ex = tgt.x! - (dx / dist) * tgtR
        const ey = tgt.y! - (dy / dist) * tgtR
        ctx.lineTo(ex, ey)
        ctx.stroke()

        // 화살촉
        const arrowSize = Math.min(lw * 3.5, 9)
        const angle = Math.atan2(dy, dx)
        ctx.fillStyle = ctx.strokeStyle
        ctx.beginPath()
        ctx.moveTo(ex, ey)
        ctx.lineTo(
          ex - arrowSize * Math.cos(angle - 0.4),
          ey - arrowSize * Math.sin(angle - 0.4)
        )
        ctx.lineTo(
          ex - arrowSize * Math.cos(angle + 0.4),
          ey - arrowSize * Math.sin(angle + 0.4)
        )
        ctx.closePath()
        ctx.fill()
      } else {
        ctx.lineTo(tgt.x!, tgt.y!)
        ctx.stroke()
      }
    }

    // 노드 그리기
    for (const n of simNodes) {
      if (n.x == null) continue
      const r = nodeRadius(n, base)
      const isSelected = n.id === selectedNodeId
      const isConnected = connectedToSelected.has(n.id)
      const nodeOpacity = selectedNodeId
        ? (isSelected || isConnected ? 1 : 0.18)
        : 1

      ctx.globalAlpha = nodeOpacity
      ctx.beginPath()
      ctx.arc(n.x!, n.y!, r, 0, Math.PI * 2)

      const color = nodeColor(n)
      ctx.fillStyle = color
      ctx.fill()

      // 테두리
      if (n.type === 'wiki') {
        ctx.strokeStyle = '#0F6E56'
        ctx.lineWidth = 1.5
        ctx.stroke()
      } else if (n.type === 'tag') {
        ctx.strokeStyle = '#185FA5'
        ctx.lineWidth = 1.5
        ctx.stroke()
      } else if (n.isStarred) {
        ctx.strokeStyle = '#EF9F27'
        ctx.lineWidth = 2
        ctx.stroke()
      } else if (n.linkCount === 0) {
        ctx.setLineDash([3, 2])
        ctx.strokeStyle = '#E24B4A'
        ctx.lineWidth = 1.5
        ctx.stroke()
        ctx.setLineDash([])
      }

      // 선택 강조
      if (isSelected) {
        ctx.beginPath()
        ctx.arc(n.x!, n.y!, r + 3, 0, Math.PI * 2)
        ctx.strokeStyle = 'rgba(124,58,237,0.8)'
        ctx.lineWidth = 2
        ctx.stroke()
      }

      // 라벨
      if (k >= 0.8) {
        ctx.globalAlpha = nodeOpacity
        ctx.fillStyle = '#374151'
        ctx.font = `${Math.max(10, 10 + (k - 1) * 2)}px sans-serif`
        ctx.textAlign = 'center'
        ctx.fillText(n.label.length > 18 ? n.label.slice(0, 18) + '…' : n.label, n.x!, n.y! + r + 12)
      }
    }

    ctx.globalAlpha = 1
    ctx.restore()
  }, [settings, selectedNodeId])

  // 시뮬레이션 wake
  const wake = useCallback((energy = 0.4) => {
    const sim = simRef.current
    if (!sim) return
    sim.alpha(Math.max(sim.alpha(), energy))
    sim.restart()
    setSimStatus('active')
  }, [])

  // 시뮬레이션 빌드
  const buildSim = useCallback(() => {
    if (simRef.current) simRef.current.stop()
    if (rafRef.current) cancelAnimationFrame(rafRef.current)

    const sim = d3.forceSimulation<GraphNode, GraphLink>(nodes)
      .force('link', d3.forceLink<GraphNode, GraphLink>(links)
        .id((n) => n.id)
        .distance(settings.linkDistance)
        .strength(0.3)
      )
      .force('charge', d3.forceManyBody().strength(-(settings.repulsion * 80)))
      .force('center', d3.forceCenter(width / 2, height / 2).strength(0.05))
      .force('collision', d3.forceCollide<GraphNode>((n) => nodeRadius(n, settings.nodeSize) + 4).iterations(2))
      .alphaDecay(0.04)
      .velocityDecay(0.55)
      .alphaMin(0.001)
      .stop() // 자동 타이머 즉시 중단 — 수동 선계산 후 재시작

    // 렌더링 없이 120틱 선계산 → 노드가 이미 퍼진 상태로 첫 화면에 노출
    for (let i = 0; i < 120; i++) sim.tick()

    simRef.current = sim
    draw() // 선계산 결과를 즉시 그리기

    const tick = () => {
      draw()
      if (sim.alpha() > sim.alphaMin()) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        setSimStatus('sleeping')
        rafRef.current = null
      }
    }

    // 선계산 후 남은 미세 조정 에너지로 계속 시뮬레이션
    sim.on('tick', () => {
      if (!rafRef.current) {
        rafRef.current = requestAnimationFrame(tick)
      }
    })

    if (sim.alpha() > sim.alphaMin()) {
      sim.restart()
      setSimStatus('active')
    } else {
      setSimStatus('sleeping')
    }
  }, [nodes, links, settings, width, height, draw])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    buildSim()
    return () => {
      simRef.current?.stop()
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [buildSim])

  // highlight 노드 처리
  useEffect(() => {
    if (!highlightNodeId || !simRef.current) return
    const found = simRef.current.nodes().find((n) => n.id === highlightNodeId)
    if (!found || found.x == null) return
    setSelectedNode(highlightNodeId)

    // 카메라 이동 (ease-out)
    const { k } = transformRef.current
    const targetX = width / 2 - found.x * k
    const targetY = height / 2 - (found.y ?? 0) * k
    let frame = 0
    const animate = () => {
      frame++
      const t = Math.min(frame / 20, 1)
      const ease = 1 - (1 - t) ** 3
      transformRef.current.x += (targetX - transformRef.current.x) * ease * 0.3
      transformRef.current.y += (targetY - transformRef.current.y) * ease * 0.3
      draw()
      if (t < 1) requestAnimationFrame(animate)
    }
    setTimeout(() => requestAnimationFrame(animate), 100)
  }, [highlightNodeId])

  // 설정 변경 시 wake
  useEffect(() => { draw() }, [settings.nodeSize, settings.linkWidth, draw])
  useEffect(() => { wake(0.5) }, [settings.centerTension, settings.repulsion, settings.linkDistance])

  // 마우스 이벤트 헬퍼
  function getNodeAt(mx: number, my: number): GraphNode | null {
    const { x, y, k } = transformRef.current
    const wx = (mx - x) / k
    const wy = (my - y) / k
    const nodes = simRef.current?.nodes() ?? []
    const base = settings.nodeSize
    for (const n of nodes) {
      if (n.x == null) continue
      const r = nodeRadius(n, base)
      const dx = wx - n.x
      const dy = wy - (n.y ?? 0)
      if (dx * dx + dy * dy < (r + 4) ** 2) return n
    }
    return null
  }

  function getCanvasXY(e: React.MouseEvent) {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { mx: e.clientX - rect.left, my: e.clientY - rect.top }
  }

  // 마우스 다운
  function handleMouseDown(e: React.MouseEvent) {
    const { mx, my } = getCanvasXY(e)
    const node = getNodeAt(mx, my)
    dragStartRef.current = { x: mx, y: my }
    isDraggingRef.current = false

    if (node) {
      dragNodeRef.current = node
      wake(0.3)
    } else {
      canvasDragRef.current = {
        startX: mx, startY: my,
        panX: transformRef.current.x,
        panY: transformRef.current.y,
      }
    }
    e.preventDefault()
  }

  function handleMouseMove(e: React.MouseEvent) {
    const { mx, my } = getCanvasXY(e)
    const dx = mx - dragStartRef.current.x
    const dy = my - dragStartRef.current.y
    if (Math.sqrt(dx * dx + dy * dy) > 3) isDraggingRef.current = true

    if (dragNodeRef.current) {
      const { x, y, k } = transformRef.current
      dragNodeRef.current.fx = (mx - x) / k
      dragNodeRef.current.fy = (my - y) / k
      wake(0.1)
    } else if (canvasDragRef.current) {
      const { startX, startY, panX, panY } = canvasDragRef.current
      transformRef.current.x = panX + (mx - startX)
      transformRef.current.y = panY + (my - startY)
      draw()
    }

    // 커서 변경
    const hovered = getNodeAt(mx, my)
    if (canvasRef.current) canvasRef.current.style.cursor = hovered ? 'pointer' : 'default'
  }

  function handleMouseUp(e: React.MouseEvent) {
    const { mx, my } = getCanvasXY(e)
    const dx = mx - dragStartRef.current.x
    const dy = my - dragStartRef.current.y
    const isClick = Math.sqrt(dx * dx + dy * dy) < 5

    if (isClick) {
      const node = getNodeAt(mx, my)
      if (node) {
        setSelectedNode(node.id === selectedNodeId ? null : node.id)
        if (node.type === 'memo') {
          // 클릭 구분 후 이동은 GraphPage에서 처리 (onNodeClick prop)
          e.currentTarget.dispatchEvent(new CustomEvent('memo-click', { detail: node.id, bubbles: true }))
        }
      } else {
        setSelectedNode(null)
      }
    }

    if (dragNodeRef.current) {
      // fx/fy 고정 유지 (핀)
      dragNodeRef.current = null
      simRef.current?.alphaTarget(0)
    }
    canvasDragRef.current = null
    isDraggingRef.current = false
    draw()
  }

  // 휠 줌
  function handleWheel(e: React.WheelEvent) {
    e.preventDefault()
    const { mx, my } = getCanvasXY(e)
    const { x, y, k } = transformRef.current
    const delta = e.deltaY > 0 ? 0.85 : 1.18
    const newK = Math.max(0.08, Math.min(3, k * delta))
    transformRef.current.x = mx - (mx - x) * (newK / k)
    transformRef.current.y = my - (my - y) * (newK / k)
    transformRef.current.k = newK
    draw()
  }

  // 터치 줌/패닝
  const touchRef = useRef<{ x: number; y: number; dist: number } | null>(null)
  function handleTouchStart(e: React.TouchEvent) {
    if (e.touches.length === 1) {
      touchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, dist: 0 }
    }
  }
  function handleTouchMove(e: React.TouchEvent) {
    if (e.touches.length === 1 && touchRef.current) {
      const dx = e.touches[0].clientX - touchRef.current.x
      const dy = e.touches[0].clientY - touchRef.current.y
      transformRef.current.x += dx
      transformRef.current.y += dy
      touchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, dist: 0 }
      draw()
    }
  }

  // 캔버스 resize 반영
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = width * dpr
    canvas.height = height * dpr
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    draw()
  }, [width, height, draw])

  return (
    <canvas
      ref={canvasRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onWheel={handleWheel}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      className="block"
    />
  )
}
