'use client'

import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { useState, useRef, useEffect } from 'react'

const PRESETS = [
  { label: '소', value: '25%' },
  { label: '중', value: '50%' },
  { label: '대', value: '75%' },
  { label: '원본', value: '100%' },
]

// 표시 너비(px) × DPR 기준으로 최적 해상도 URL 반환
// 항상 이미지 해상도 > 표시 픽셀 수 를 보장 (업스케일 방지)
// srcSm: 480w / srcMd: 960w / src: 1920w
function pickSrc(
  displayWidth: number,
  srcFull: string,
  srcMd: string | null,
  srcSm: string | null,
): string {
  const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1
  const effective = displayWidth * dpr
  // 임계값을 이미지 해상도보다 낮게 설정 → 항상 다운스케일 보장
  if (srcSm && effective <= 400) return srcSm   // 480w 이미지, 최대 400 effective px
  if (srcMd && effective <= 800) return srcMd   // 960w 이미지, 최대 800 effective px
  return srcFull                                // 1920w
}

export function ResizableImageView({ node, updateAttributes }: NodeViewProps) {
  const [selected, setSelected] = useState(false)
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null)
  const [activeSrc, setActiveSrc] = useState(node.attrs.src as string)
  const imgRef = useRef<HTMLImageElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const startRef = useRef({ x: 0, initW: 0 })

  const widthAttr = node.attrs.width as string | null
  const srcFull = node.attrs.src as string
  const srcMd = (node.attrs.srcMd as string | null) ?? null
  const srcSm = (node.attrs.srcSm as string | null) ?? null

  // 실제 렌더 크기를 감시해 최적 해상도 URL을 동적으로 선택
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const observer = new ResizeObserver(([entry]) => {
      setActiveSrc(pickSrc(entry.contentRect.width, srcFull, srcMd, srcSm))
    })
    observer.observe(el)
    // 마운트 직후 초기값 즉시 반영
    setActiveSrc(pickSrc(el.offsetWidth, srcFull, srcMd, srcSm))

    return () => observer.disconnect()
  }, [srcFull, srcMd, srcSm])

  function startResize(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    const img = imgRef.current
    if (!img) return
    startRef.current = { x: e.clientX, initW: img.offsetWidth }

    function onMove(ev: MouseEvent) {
      const dx = ev.clientX - startRef.current.x
      const newW = Math.max(60, startRef.current.initW + dx)
      updateAttributes({ width: `${Math.round(newW)}px` })
    }

    function onUp() {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  function displaySize(): string {
    const img = imgRef.current
    if (!img) return ''
    return `${img.offsetWidth} × ${img.offsetHeight}`
  }

  return (
    <NodeViewWrapper
      ref={containerRef}
      as="div"
      className="relative inline-block max-w-full my-1"
      style={{ width: widthAttr ?? '100%', maxWidth: naturalSize ? `${naturalSize.w}px` : '100%' }}
      onClick={(e: React.MouseEvent) => { e.stopPropagation(); setSelected((v) => !v) }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={activeSrc}
        alt={(node.attrs.alt as string) || ''}
        style={{ width: '100%', display: 'block', outline: selected ? '2px solid #7C3AED' : 'none', borderRadius: 2 }}
        onLoad={() => {
          const img = imgRef.current
          if (img) setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight })
        }}
        draggable={false}
      />

      {selected && (
        <>
          {/* 우하단 리사이즈 핸들 */}
          <div
            className="absolute bottom-0 right-0 w-4 h-4 bg-violet-600 cursor-se-resize z-10"
            style={{ borderRadius: '0 0 3px 0' }}
            onMouseDown={startResize}
          />

          {/* 프리셋 툴바 */}
          <div className="absolute -top-8 left-0 flex items-center gap-1 bg-gray-900/85 rounded-md px-1.5 py-1 z-10">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                onMouseDown={(e) => { e.preventDefault(); updateAttributes({ width: p.value }) }}
                className="text-[10px] text-white px-1.5 py-0.5 rounded hover:bg-white/20 transition-colors"
              >
                {p.label} {p.value}
              </button>
            ))}
            {naturalSize && (
              <span className="text-[10px] text-gray-400 ml-1">{displaySize()}</span>
            )}
          </div>
        </>
      )}
    </NodeViewWrapper>
  )
}
