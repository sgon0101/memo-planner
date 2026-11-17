'use client'

/**
 * 탭 이동 대기 줄이기 (2026-11-17).
 *
 * 하단 탭(플래너·그래프·AI 등)을 누르면 Next가 서버(Vercel)에 그 화면 정보(RSC)를 물어본 뒤에야 화면을 바꾼다.
 * 서버가 깨어 있으면 0.2초, 몇 시간 쉬어 잠들어 있으면 1초 넘게 걸린다.
 * → 앱이 한가해지면 주요 탭의 화면 정보를 미리 받아 두고(누르면 바로 바뀜, 5분 유효),
 *   각 탭의 본체 코드(달력·그래프·AI 대화)도 미리 읽어 둔다(처음 누를 때 내려받기 대기 없음).
 * 미리 받기 요청이 잠든 서버를 먼저 깨우는 효과도 있다. 앱으로 돌아왔을 때 5분이 지났으면 다시 받는다.
 */

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { PrefetchKind } from 'next/dist/client/components/router-reducer/router-reducer-types'
import { BUILD_TIME, SHELL_PATHS, preloadShellChunks, refreshShell, shellNeedsRefresh } from '@/lib/pwa/homeShell'

const TABS = ['/home', '/memo', '/planner', '/graph', '/insights', '/settings']
const REFRESH_MS = 5 * 60 * 1000

function whenIdle(fn: () => void, delay: number): () => void {
  let idleId: number | null = null
  const t = setTimeout(() => {
    if ('requestIdleCallback' in window) idleId = window.requestIdleCallback(fn, { timeout: 3000 })
    else fn()
  }, delay)
  return () => {
    clearTimeout(t)
    if (idleId !== null && 'cancelIdleCallback' in window) window.cancelIdleCallback(idleId)
  }
}

/**
 * 탭마다 화면 셸(HTML)을 받아 두고(안드로이드가 마지막 화면으로 다시 열 때도 바로 뜸 — 방문 전 탭 포함),
 * 그 셸이 쓰는 코드 파일을 미리 받는다. 셸이 이미 이번 빌드면 HTML은 다시 받지 않는다(배포당 1회).
 */
let shellsWarmed = false
async function warmShells() {
  if (shellsWarmed || !BUILD_TIME || !navigator.serviceWorker?.controller) return
  shellsWarmed = true
  for (const path of SHELL_PATHS) {
    if (await shellNeedsRefresh(path)) {
      const r = await refreshShell(path)
      if (r === 'auth-lost') return
    }
    await preloadShellChunks(path)
  }
}

let chunksLoaded = false
function preloadTabCode() {
  if (chunksLoaded) return
  chunksLoaded = true
  // 실패해도 무시 — 탭을 누를 때 원래대로 받는다
  void import('@/components/planner/CalendarView').catch(() => {})
  void import('@/components/graph/GraphView').catch(() => {})
  void import('@/components/insights/AIChatLayout').catch(() => {})
}

export function TabWarmup() {
  const router = useRouter()

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return
    let lastAt = 0
    const prefetchTabs = () => {
      if (!navigator.onLine) return
      // 데이터 절약 모드면 미리 받지 않는다
      if ((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData) return
      lastAt = Date.now()
      for (const href of TABS) {
        try { router.prefetch(href, { kind: PrefetchKind.FULL }) } catch { /* ignore */ }
      }
      preloadTabCode()
      void warmShells()
    }

    const cancel = whenIdle(prefetchTabs, 2500)
    let cancelResume: (() => void) | null = null
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastAt < REFRESH_MS) return
      cancelResume?.()
      cancelResume = whenIdle(prefetchTabs, 1500)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancel()
      cancelResume?.()
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [router])

  return null
}
