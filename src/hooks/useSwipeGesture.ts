'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * useSwipeGesture — 터치/포인터 swipe 제스처 통합 훅
 *
 * 기존에 Sidebar(좌 swipe 닫기) / PlanPanel(하 swipe 닫기) / CalendarView(좌우 swipe 네비게이션)가
 * 각각 PointerEvent + native touch fallback을 수동 구현하던 것을 단일 파이프라인으로 정규화.
 *
 * - PointerEvent 파이프라인 + native Touch fallback 이중 구동 (일부 모바일에서 PointerEvent 미발화 대응)
 *   → commit 시 200ms dedupe 가드로 이중 발화 차단
 * - 축 잠금(lockAt) 후에만 시각 피드백/스크롤 차단 → 링크·버튼 탭 정상 동작
 * - 축 잠금 후 setPointerCapture (즉시 capture 시 내부 탭이 막히는 버그 방지)
 * - suppressClickAfterSwipe: swipe 직후 click 1회 차단 (셀 클릭 오발화 방지)
 */

type PointerKind = 'mouse' | 'touch' | 'pen'

export interface SwipeGestureOptions {
  /** 주축 — 'x'(좌우) | 'y'(상하) */
  axis: 'x' | 'y'
  onSwipeLeft?: () => void
  onSwipeRight?: () => void
  onSwipeUp?: () => void
  onSwipeDown?: () => void
  /** commit 최소 거리(px). 기본 70 */
  threshold?: number
  /** commit 최대 시간(ms). 기본 600 */
  maxDuration?: number
  /** 주축이 교차축보다 우세해야 하는 배율. 기본 1.2 */
  dominance?: number
  /** 축 잠금(드래그 인식) 시작 거리(px). 기본 10 */
  lockAt?: number
  /** 드래그 시각 피드백 클램프 [min, max]. 기본 [0, 0] = 피드백 없음 */
  dragClamp?: [number, number]
  /** false면 제스처 비활성. 기본 true */
  enabled?: boolean
  /** true면 viewport < 768px에서만 동작 */
  mobileOnly?: boolean
  /** 허용 포인터 타입. 기본 전부 (touch 전용이면 ['touch']) */
  pointerTypes?: PointerKind[]
  /** 이 selector에 매칭되는 타깃에서 시작한 제스처는 무시 (예: 'button, a, input') */
  ignoreFrom?: string
  /** 축 잠금 후 브라우저 스크롤/pull-to-refresh 차단. 기본 false */
  preventScroll?: boolean
  /** 축 잠금 후 setPointerCapture. 기본 true */
  capturePointer?: boolean
  /** swipe commit 직후 click 1회 차단 — 반환된 onClickCapture를 부착해야 동작 */
  suppressClickAfterSwipe?: boolean
}

interface GestureState {
  x: number
  y: number
  t: number
  locked: boolean
}

export function useSwipeGesture<T extends HTMLElement = HTMLElement>(options: SwipeGestureOptions) {
  /** 주축 방향 드래그 거리 (시각 피드백용, dragClamp 범위로 클램프됨) */
  const [drag, setDrag] = useState(0)
  const ref = useRef<T | null>(null)

  // 항상 최신 옵션 참조 — effect 재부착 없이 옵션 변경 반영
  const opts = useRef(options)
  opts.current = options

  const pState = useRef<GestureState | null>(null) // PointerEvent 파이프라인
  const tState = useRef<GestureState | null>(null) // Touch fallback 파이프라인
  const lastCommit = useRef(0)
  const swipedRecently = useRef(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    function begin(x: number, y: number, target: EventTarget | null): GestureState | null {
      const o = opts.current
      if (o.enabled === false) return null
      if (o.mobileOnly && typeof window !== 'undefined' && window.innerWidth >= 768) return null
      if (o.ignoreFrom && target instanceof Element && target.closest(o.ignoreFrom)) return null
      return { x, y, t: Date.now(), locked: false }
    }

    /** @returns 이번 move에서 축 잠금이 새로 발생했는지 */
    function move(st: GestureState, x: number, y: number): boolean {
      const o = opts.current
      const dx = x - st.x
      const dy = y - st.y
      const main = o.axis === 'x' ? dx : dy
      const cross = o.axis === 'x' ? dy : dx
      let lockedNow = false
      if (!st.locked && Math.abs(main) > (o.lockAt ?? 10) && Math.abs(main) > Math.abs(cross)) {
        st.locked = true
        lockedNow = true
      }
      if (st.locked) {
        const [min, max] = o.dragClamp ?? [0, 0]
        setDrag(Math.min(Math.max(main, min), max))
      }
      return lockedNow
    }

    function end(st: GestureState, x: number, y: number) {
      const o = opts.current
      setDrag(0)
      const dx = x - st.x
      const dy = y - st.y
      const dt = Date.now() - st.t
      const main = o.axis === 'x' ? dx : dy
      const cross = o.axis === 'x' ? dy : dx
      if (Math.abs(main) < (o.threshold ?? 70)) return
      if (Math.abs(main) < Math.abs(cross) * (o.dominance ?? 1.2)) return
      if (dt > (o.maxDuration ?? 600)) return
      // pointer + touch 이중 발화 dedupe
      const now = Date.now()
      if (now - lastCommit.current < 200) return
      lastCommit.current = now
      if (o.suppressClickAfterSwipe) {
        swipedRecently.current = true
        setTimeout(() => { swipedRecently.current = false }, 350)
      }
      if (o.axis === 'x') (main < 0 ? o.onSwipeLeft : o.onSwipeRight)?.()
      else (main < 0 ? o.onSwipeUp : o.onSwipeDown)?.()
    }

    // ── PointerEvent 파이프라인 ──────────────────────────────────────
    function onPointerDown(e: PointerEvent) {
      const o = opts.current
      if (o.pointerTypes && !o.pointerTypes.includes(e.pointerType as PointerKind)) return
      pState.current = begin(e.clientX, e.clientY, e.target)
    }
    function onPointerMove(e: PointerEvent) {
      const st = pState.current
      if (!st) return
      const lockedNow = move(st, e.clientX, e.clientY)
      if (lockedNow && opts.current.capturePointer !== false) {
        try { el!.setPointerCapture(e.pointerId) } catch { /* ignore */ }
      }
    }
    function onPointerEnd(e: PointerEvent) {
      const st = pState.current
      if (!st) return
      pState.current = null
      try { el!.releasePointerCapture(e.pointerId) } catch { /* ignore */ }
      if (e.type === 'pointercancel') { setDrag(0); return }
      end(st, e.clientX, e.clientY)
    }

    // ── Touch fallback 파이프라인 (+ preventScroll) ──────────────────
    function onTouchStart(e: TouchEvent) {
      if (e.touches.length !== 1) return
      const t = e.touches[0]
      tState.current = begin(t.clientX, t.clientY, e.target)
    }
    function onTouchMove(e: TouchEvent) {
      const st = tState.current
      if (!st || e.touches.length !== 1) return
      const t = e.touches[0]
      move(st, t.clientX, t.clientY)
      if (st.locked && opts.current.preventScroll && e.cancelable) e.preventDefault()
    }
    function onTouchEnd(e: TouchEvent) {
      const st = tState.current
      if (!st) return
      tState.current = null
      if (e.type === 'touchcancel') { setDrag(0); return }
      const t = e.changedTouches[0]
      end(st, t.clientX, t.clientY)
    }

    el.addEventListener('pointerdown', onPointerDown)
    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerup', onPointerEnd)
    el.addEventListener('pointercancel', onPointerEnd)
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd, { passive: true })
    el.addEventListener('touchcancel', onTouchEnd, { passive: true })

    return () => {
      el.removeEventListener('pointerdown', onPointerDown)
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerup', onPointerEnd)
      el.removeEventListener('pointercancel', onPointerEnd)
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      el.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [])

  /** suppressClickAfterSwipe 사용 시 컨테이너에 부착 */
  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (swipedRecently.current) {
      e.stopPropagation()
      e.preventDefault()
    }
  }, [])

  return { ref, drag, onClickCapture }
}
