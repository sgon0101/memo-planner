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
import { AIChatTab, CalendarTab, GraphTab } from '@/components/tabs/lazyTabs'

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

// lazyTabs의 preload — 다 읽어 두면 탭을 처음 열 때도 스켈레톤 없이 바로 그린다. 실패해도 무시(탭을 누를 때 다시 받는다).
// 플래너·AI 대화는 앱을 연 직후 바로(2026-11-19 PC 실측: 한가할 때로 미루면 1.5초 시점까지도 안 읽혀 있었다),
// 무거운 그래프(d3)는 한가할 때. 코드 파일은 서비스워커 캐시에서 오므로 받는 시간은 거의 없고 읽는 시간만 든다.
let mainCodeLoaded = false
function preloadMainTabCode() {
  if (mainCodeLoaded) return
  mainCodeLoaded = true
  void CalendarTab.preload().catch(() => {})
  void AIChatTab.preload().catch(() => {})
}
let graphCodeLoaded = false
function preloadGraphCode() {
  if (graphCodeLoaded) return
  graphCodeLoaded = true
  void GraphTab.preload().catch(() => {})
}

export function TabWarmup() {
  const router = useRouter()

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return
    let lastAt = 0
    const canPrefetch = () =>
      navigator.onLine &&
      // 데이터 절약 모드면 미리 받지 않는다
      !(navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData

    // ① 탭 화면 정보(RSC) — 앱을 연 직후 바로 (2026-11-19).
    //    홈은 저장된 셸로 서버 없이 뜨기 때문에, 예전엔 사용자가 처음 누른 탭이 잠든 Vercel 서버를 깨우는
    //    첫 요청이 됐다(누른 뒤 1초 넘게 아무 반응 없음). 바로 보내면 서버가 그 사이 깨고, 누른 탭은
    //    이미 출발한 요청을 이어받는다. 요청이 작아 홈 데이터 받기를 방해하지 않는다.
    const prefetchRsc = () => {
      if (!canPrefetch()) return
      lastAt = Date.now()
      for (const href of TABS) {
        try { router.prefetch(href, { kind: PrefetchKind.FULL }) } catch { /* ignore */ }
      }
    }
    // ② 그래프 코드 읽기·셸 저장 — 메인 스레드를 쓰므로 첫 화면이 자리 잡은 뒤 한가할 때
    const warmHeavy = () => {
      if (!canPrefetch()) return
      preloadGraphCode()
      void warmShells()
    }

    const rscTimer = setTimeout(() => {
      prefetchRsc()
      // 데이터 절약 모드여도 코드는 서비스워커 캐시에서 읽으므로 받는다(오프라인이어도 캐시에 있으면 됨)
      preloadMainTabCode()
    }, 0)
    const cancel = whenIdle(warmHeavy, 800)
    let cancelResume: (() => void) | null = null
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastAt < REFRESH_MS) return
      prefetchRsc()
      cancelResume?.()
      cancelResume = whenIdle(warmHeavy, 800)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearTimeout(rscTimer)
      cancel()
      cancelResume?.()
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [router])

  return null
}
