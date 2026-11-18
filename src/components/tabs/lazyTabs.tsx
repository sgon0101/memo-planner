'use client'

/**
 * 탭 본체(달력·그래프·AI 대화)를 미리 읽어 두면 처음 열 때도 바로 그리는 지연 컴포넌트 (2026-11-19).
 *
 * next/dynamic(ssr:false)은 코드를 이미 받아 뒀어도 처음 그릴 때 한 번은 Suspense 대체 화면(스켈레톤)을 띄운다.
 * React 19는 대체 화면을 띄운 뒤 본 화면으로 바꾸는 것을 최소 300ms 묶어서 처리해서,
 * 첫 진입에서 '스켈레톤 → 화면'이 그려지는 과정이 그대로 보였다(두 번째부터는 같은 컴포넌트를 다시 쓰므로 안 보임).
 * → 코드를 다 읽었으면 Suspense 없이 바로 그린다.
 * 아직 덜 읽었을 때(앱을 열자마자 탭을 누른 경우, 2026-11-19 PC 실측 1.5초 시점):
 *   - 탭 이동(클라이언트 렌더)이면 코드가 올 때까지 렌더를 멈춘다(use). Next의 화면 이동은 전환(transition)이라
 *     React가 스켈레톤 대신 지금 화면을 그대로 두었다가, 코드가 오는 즉시 새 화면으로 바꾼다(0.1~0.3초).
 *     누른 탭은 내비가 바로 활성 표시하므로 '안 눌린 것처럼' 보이지 않는다.
 *   - 그 주소로 앱을 처음 연 경우(하이드레이션)는 보여 줄 이전 화면이 없으므로 스켈레톤 → 코드가 오면 교체.
 * TabWarmup이 앱을 연 직후 preload()를 불러 두고, 내비는 손가락이 닿거나(모바일) 마우스가 올라갈 때(PC) 부른다.
 */

import { use, useEffect, useReducer, useState, useSyncExternalStore, type ComponentType } from 'react'
import { CalendarSkeleton, GraphSkeleton, InsightsSkeleton } from '@/components/ui/Skeleton'

type Loader = () => Promise<{ default: ComponentType }>

const noopSubscribe = () => () => {}

/** 하이드레이션 중이면 false(서버 HTML과 같게 스켈레톤), 그 뒤 클라이언트 렌더(탭 이동)면 처음부터 true */
function useIsClient(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false)
}

function preloadable(loader: Loader, Fallback: ComponentType) {
  let Loaded: ComponentType | null = null
  let pending: Promise<void> | null = null

  // use()에 넘길 '끝나면 풀리는' 약속 — 실패해도 거부하지 않는다(오류 화면 대신 스켈레톤 + 재시도로)
  let settled: Promise<void> | null = null
  const settle = (): Promise<void> => (settled ??= preload().catch(() => {}))

  const preload = (): Promise<void> => {
    pending ??= loader()
      .then((m) => { Loaded = m.default })
      .catch((e) => {
        pending = null // 다음에 다시 시도
        throw e
      })
    return pending
  }

  function TabBody() {
    const isClient = useIsClient()
    // 하이드레이션 중에 처음 그려졌는지(= 이 주소로 앱을 연 경우) — 그 뒤 리렌더에서도 유지
    const [startedInHydration] = useState(!isClient)
    const [, rerender] = useReducer((n: number) => n + 1, 0)

    useEffect(() => {
      if (Loaded) return
      let alive = true
      preload().then(
        () => { if (alive) rerender() },
        (e) => console.error('[lazyTabs] 화면 코드를 불러오지 못했어요', e),
      )
      return () => { alive = false }
    }, [])

    // 탭 이동으로 처음 그리는데 코드가 아직이면 렌더를 멈춘다 → 이전 화면 유지 (위 설명)
    if (!Loaded && isClient && !startedInHydration) use(settle())
    if (!isClient || !Loaded) return <Fallback />
    return <Loaded />
  }

  return Object.assign(TabBody, { preload })
}

export const CalendarTab = preloadable(() => import('@/components/planner/CalendarView'), CalendarSkeleton)
export const GraphTab = preloadable(() => import('@/components/graph/GraphView'), GraphSkeleton)
export const AIChatTab = preloadable(() => import('@/components/insights/AIChatLayout'), InsightsSkeleton)

/** 탭 주소 → 본체 코드 미리 읽기 (MobileNav·Sidebar·TabWarmup 공용) */
export const TAB_PRELOAD: Record<string, () => Promise<void>> = {
  '/planner': CalendarTab.preload,
  '/insights': AIChatTab.preload,
  '/graph': GraphTab.preload,
}
