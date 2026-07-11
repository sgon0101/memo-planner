'use client'

import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import { useState, useRef, useEffect } from 'react'
import { getImageBlob } from '@/lib/sync/queueDB'
import { withImgCacheVersion } from '@/lib/utils'

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
  if (srcSm && effective <= 400) return srcSm
  if (srcMd && effective <= 800) return srcMd
  return srcFull
}

/**
 * ResizableImageView — Tiptap 이미지 노드 뷰
 *
 * 주요 설계:
 *  - `selected`는 Tiptap이 NodeViewProps로 내려주는 PM NodeSelection 상태 사용
 *    → 로컬 useState 제거, PM과 selection 일관성 보장
 *  - 클릭 시 `editor.commands.setNodeSelection(getPos())`로 명시적으로 노드 선택
 *    → 이전에 stopPropagation 때문에 selection이 stale 상태로 남아 다른 위치로
 *      scrollIntoView가 발화하던 버그 해결
 *  - `setNaturalSize`는 prev ?? 패턴으로 1회만 기록
 *    → src 동적 교체로 onLoad가 재발화해도 layout shift 없음
 *  - 리사이즈 핸들/드래그는 PointerEvent로 마우스+터치 통합
 *  - 모바일에서 핸들 크기 24px, 툴바 위치는 top 잘림 방지
 */
export function ResizableImageView({ node, updateAttributes, editor, getPos, selected }: NodeViewProps) {
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null)
  const [activeSrc, setActiveSrc] = useState(node.attrs.src as string)
  const [toolbarBelow, setToolbarBelow] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const startRef = useRef({ x: 0, initW: 0 })
  // 모바일 탭/스크롤 판별 — touchstart 좌표 기록, touchend에서 거리 비교
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)

  const widthAttr = node.attrs.width as string | null
  const srcFull = node.attrs.src as string
  const srcMd = (node.attrs.srcMd as string | null) ?? null
  const srcSm = (node.attrs.srcSm as string | null) ?? null
  // PR-M1-C: 오프라인 임시 이미지 — IDB의 image_blobs에서 blob을 꺼내 blob URL 생성
  const localBlobId = (node.attrs.localBlobId as string | null) ?? null
  const [blobUrl, setBlobUrl] = useState<string | null>(null)

  // localBlobId가 있으면 IDB에서 blob 가져와 URL 생성. unmount 시 revoke.
  useEffect(() => {
    let cancelled = false
    let url: string | null = null
    if (!localBlobId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- localBlobId 사라지면 blobUrl 해제
      setBlobUrl(null)
      return
    }
    getImageBlob(localBlobId).then((entry) => {
      if (cancelled || !entry) return
      url = URL.createObjectURL(entry.blob)
      setBlobUrl(url)
    })
    return () => {
      cancelled = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [localBlobId])

  // 실제 렌더 크기를 감시해 최적 해상도 URL 동적 선택
  // blobUrl이 있으면 (오프라인 임시 이미지) 그것을 우선 사용 — 변형본이 아직 없으므로 단일 URL
  useEffect(() => {
    if (blobUrl) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- blobUrl로 직접 표시 (resize observer 불필요)
      setActiveSrc(blobUrl)
      return
    }
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      setActiveSrc(pickSrc(entry.contentRect.width, srcFull, srcMd, srcSm))
    })
    observer.observe(el)
    setActiveSrc(pickSrc(el.offsetWidth, srcFull, srcMd, srcSm))
    return () => observer.disconnect()
  }, [srcFull, srcMd, srcSm, blobUrl])

  // 선택될 때 툴바가 화면 위로 잘리는지 측정 → 아래로 배치
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 선택 해제 시 리셋 (의도된 패턴)
    if (!selected) { setToolbarBelow(false); return }
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    // 위로 띄울 공간이 32px 이하면 아래로
    setToolbarBelow(rect.top < 40)
  }, [selected])

  // mousedown을 PM에 전달하지 않음:
  // PM의 mouseup 핸들러는 mousedown 기록이 없으면 tr.scrollIntoView()를 dispatch하지 않는다.
  // e.preventDefault()로 브라우저 기본 포커스·커서 이동도 차단.
  function handleMouseDown(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
  }

  // click 시 NodeSelection을 명시적으로 설정 (scrollIntoView 없음).
  // PM이 mousedown을 못 봤으므로 여기서 포커스도 직접 부여.
  function handleClick(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (!editor) return
    const pos = typeof getPos === 'function' ? getPos() : null
    if (typeof pos === 'number') {
      editor.commands.setNodeSelection(pos)
      editor.view.dom.focus({ preventScroll: true })
    }
  }

  // 리사이즈 — PointerEvent로 마우스+터치 통합 + setPointerCapture로 화면 밖 손가락 추적
  function startResize(e: React.PointerEvent) {
    e.preventDefault()
    e.stopPropagation()
    const img = imgRef.current
    if (!img) return
    const target = e.currentTarget as HTMLElement
    try { target.setPointerCapture(e.pointerId) } catch { /* ignore */ }
    startRef.current = { x: e.clientX, initW: img.offsetWidth }
    const pointerId = e.pointerId

    function onMove(ev: PointerEvent) {
      if (ev.pointerId !== pointerId) return
      const dx = ev.clientX - startRef.current.x
      const newW = Math.max(60, startRef.current.initW + dx)
      updateAttributes({ width: `${Math.round(newW)}px` })
    }
    function onUp(ev: PointerEvent) {
      if (ev.pointerId !== pointerId) return
      try { target.releasePointerCapture(pointerId) } catch { /* ignore */ }
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerup', onUp)
      document.removeEventListener('pointercancel', onUp)
    }
    document.addEventListener('pointermove', onMove)
    document.addEventListener('pointerup', onUp)
    document.addEventListener('pointercancel', onUp)
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
      className="relative block max-w-full my-0"
      // pointerEvents: 'none' — wrapper 자체 hit 차단. 자식(img/리사이즈 핸들/툴바)만
      // 명시적으로 'auto'로 활성화해, 이미지 옆 빈 공간 터치는 PM 부모로 패스되어
      // selection 해제됨.
      style={{
        width: widthAttr ?? '100%',
        maxWidth: naturalSize ? `${naturalSize.w}px` : '100%',
        pointerEvents: 'none',
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={withImgCacheVersion(activeSrc)}
        alt={(node.attrs.alt as string) || ''}
        style={{
          width: '100%',
          display: 'block',
          outline: selected ? '2px solid #7C3AED' : 'none',
          borderRadius: 2,
          cursor: 'pointer',
          pointerEvents: 'auto',
        }}
        // hit 영역을 img로 한정 — wrapper는 fit-content + 외부 click 차단해
        // 이미지 옆 빈 공간 터치도 image selection으로 묶이던 회귀 fix.
        onMouseDown={handleMouseDown}
        onClick={handleClick}
        onTouchStart={(e: React.TouchEvent) => {
          const t = e.touches[0]
          if (t) touchStartRef.current = { x: t.clientX, y: t.clientY }
        }}
        onTouchEnd={(e: React.TouchEvent) => {
          if (!editor) return
          const target = e.target as HTMLElement
          if (target.closest('button') || target.dataset.resizeHandle === '1') return
          e.preventDefault()
          const start = touchStartRef.current
          touchStartRef.current = null
          const end = e.changedTouches[0]
          if (start && end) {
            const dx = Math.abs(end.clientX - start.x)
            const dy = Math.abs(end.clientY - start.y)
            if (dx > 10 || dy > 10) return
          }
          const pos = typeof getPos === 'function' ? getPos() : null
          if (typeof pos === 'number') {
            editor.commands.setNodeSelection(pos)
            editor.view.dom.focus({ preventScroll: true })
          }
        }}
        onLoad={() => {
          const img = imgRef.current
          if (!img) return
          setNaturalSize((prev) => prev ?? { w: img.naturalWidth, h: img.naturalHeight })
        }}
        draggable={false}
      />

      {selected && (
        <>
          {/* 우하단 리사이즈 핸들 — 데스크탑 16px, 모바일 24px */}
          <div
            data-resize-handle="1"
            className="absolute bottom-0 right-0 w-4 h-4 max-md:w-6 max-md:h-6 bg-violet-600 cursor-se-resize z-10 touch-none"
            style={{ borderRadius: '0 0 3px 0', pointerEvents: 'auto' }}
            onPointerDown={startResize}
            aria-label="이미지 크기 조정"
          />

          {/* 프리셋 툴바 — 화면 위 공간 부족 시 이미지 안쪽 상단으로 자동 이동 */}
          <div
            className={
              toolbarBelow
                ? 'absolute top-2 left-2 flex items-center gap-1 bg-gray-900/85 rounded-md px-1.5 py-1 z-10 max-w-[calc(100%-1rem)] overflow-x-auto'
                : 'absolute -top-8 left-0 flex items-center gap-1 bg-gray-900/85 rounded-md px-1.5 py-1 z-10 max-w-full overflow-x-auto'
            }
            style={{ pointerEvents: 'auto' }}
          >
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => { e.stopPropagation(); updateAttributes({ width: p.value }) }}
                className="text-[10px] text-white px-1.5 py-0.5 rounded hover:bg-white/20 active:bg-white/30 transition-colors whitespace-nowrap touch-manipulation"
              >
                {p.label} {p.value}
              </button>
            ))}
            {naturalSize && (
              // eslint-disable-next-line react-hooks/refs -- 리사이즈 실측 표시 (widthAttr 변경마다 리렌더되므로 최신값 보장)
              <span className="text-[10px] text-gray-400 ml-1 whitespace-nowrap">{displaySize()}</span>
            )}

          </div>
        </>
      )}
    </NodeViewWrapper>
  )
}
