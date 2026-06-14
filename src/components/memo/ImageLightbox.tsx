'use client'

/**
 * 이미지 라이트박스 — 메모 내 이미지 클릭 시 풀스크린 확대 보기.
 *
 * UX:
 *  - 배경/X 버튼/ESC 클릭으로 닫힘
 *  - 이미지 영역은 클릭해도 안 닫힘(보고 있는 동안 의도치 않은 닫힘 방지)
 *  - 모바일 핀치 줌 허용: touch-action: pinch-zoom + container 자체 overflow scroll
 *  - body 스크롤 잠금
 *
 * 트리거: uiStore.openLightbox(src) — ResizableImageView 클릭 핸들러에서 호출
 */

import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useUIStore } from '@/store/uiStore'

export default function ImageLightbox() {
  const src = useUIStore((s) => s.lightboxImageSrc)
  const close = useUIStore((s) => s.closeLightbox)

  // ESC 닫기 + body 스크롤 잠금
  useEffect(() => {
    if (!src) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [src, close])

  if (!src || typeof window === 'undefined') return null

  return createPortal(
    <div
      className="fixed inset-0 z-[400] bg-black/90 flex items-center justify-center overflow-auto"
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-label="이미지 확대 보기"
      style={{ touchAction: 'pinch-zoom' }}
    >
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); close() }}
        className="fixed top-4 right-4 z-10 w-11 h-11 flex items-center justify-center rounded-full bg-white/15 hover:bg-white/25 text-white transition-colors"
        aria-label="닫기"
      >
        <X size={22} />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        className="max-w-[95vw] max-h-[95vh] object-contain select-none"
        // 이미지 자체 클릭은 닫힘 차단 — 사용자가 이미지 위 핀치/드래그할 수 있게
        onClick={(e) => e.stopPropagation()}
        draggable={false}
      />
    </div>,
    document.body,
  )
}
