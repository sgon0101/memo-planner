'use client'

import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { useState, useRef } from 'react'

const PRESETS = [
  { label: '소', value: '25%' },
  { label: '중', value: '50%' },
  { label: '대', value: '75%' },
  { label: '원본', value: '100%' },
]

export function ResizableImageView({ node, updateAttributes }: NodeViewProps) {
  const [selected, setSelected] = useState(false)
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const startRef = useRef({ x: 0, initW: 0 })

  const widthAttr = node.attrs.width as string | null

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
      style={{ width: widthAttr ?? '100%' }}
      onClick={(e: React.MouseEvent) => { e.stopPropagation(); setSelected((v) => !v) }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={node.attrs.src as string}
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
