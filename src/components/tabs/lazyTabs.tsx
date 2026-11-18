'use client'

/**
 * 탭 본체(달력·그래프·AI 대화)를 미리 읽어 두면 처음 열 때도 바로 그리는 지연 컴포넌트 (2026-11-19).
 *
 * next/dynamic(ssr:false)은 코드를 이미 받아 뒀어도 처음 그릴 때 한 번은 Suspense 대체 화면(스켈레톤)을 띄운다.
 * React 19는 대체 화면을 띄운 뒤 본 화면으로 바꾸는 것을 최소 300ms 묶어서 처리해서,
 * 첫 진입에서 '스켈레톤 → 화면'이 그려지는 과정이 그대로 보였다(두 번째부터는 같은 컴포넌트를 다시 쓰므로 안 보임).
 * → 코드를 다 읽었으면 Suspense 없이 바로 그린다. 아직이면 스켈레톤을 보여 주고 다 읽는 즉시 바꾼다.
 * TabWarmup이 앱을 연 직후 preload()를 불러 둔다.
 */

import { useEffect, useReducer, useSyncExternalStore, type ComponentType } from 'react'
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

    if (!isClient || !Loaded) return <Fallback />
    return <Loaded />
  }

  return Object.assign(TabBody, { preload })
}

export const CalendarTab = preloadable(() => import('@/components/planner/CalendarView'), CalendarSkeleton)
export const GraphTab = preloadable(() => import('@/components/graph/GraphView'), GraphSkeleton)
export const AIChatTab = preloadable(() => import('@/components/insights/AIChatLayout'), InsightsSkeleton)
