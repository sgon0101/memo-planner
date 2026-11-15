/**
 * 앱 시작 속도 측정 (임시 진단 — 원인 확인 후 제거 예정, 2026-11-15)
 *
 * 몇 시간 뒤 첫 실행이 두 번째 실행보다 느린 이유를 폰에서 직접 재기 위한 기록.
 * 시작 후 10초 동안의 시점을 모아 localStorage에 최근 8개만 남기고, 설정 화면 맨 아래에서 본다.
 * 화면을 다시 보여주기만 한 경우(메모리에 남아 있던 페이지)도 'resume'으로 따로 남긴다.
 * 메모 내용·사용자 정보는 저장하지 않는다(시간 숫자만).
 */

'use client'

export const STARTUP_TRACE_KEY = 'weave:startup-trace'
const MAX_ENTRIES = 8
const FINALIZE_MS = 10_000

export type StartupMark = 'hydrated' | 'userId' | 'home' | 'homeFresh' | 'token' | 'prefetch'

export interface StartupEntry {
  at: number                // 기록 시각 (epoch ms)
  kind: 'cold' | 'resume'
  path: string
  navType?: string          // navigate | reload | back_forward | prerender
  sw?: boolean              // 서비스워커가 응답했는지
  discarded?: boolean       // 폰이 탭을 메모리에서 지웠다가 다시 연 경우 true
  hiddenMin?: number        // resume: 백그라운드에 있던 시간(분)
  html?: number             // HTML 첫 바이트 도착 (ms, 시작 기준)
  dcl?: number              // DOMContentLoaded 끝
  fcp?: number              // 첫 화면 표시
  marks: Partial<Record<StartupMark, number>>
  longTaskMs?: number       // 처음 10초 동안 화면이 멈춘 총시간
  longTaskCount?: number
  jsKB?: number             // 읽은 JS 크기(압축 해제 기준)
  jsFiles?: number
  jsFromNetwork?: number    // 네트워크에서 받은 JS 파일 수 (나머지는 캐시)
}

const marks: Partial<Record<StartupMark, number>> = {}
let started = false
let longTaskMs = 0
let longTaskCount = 0

/** 시작 후 처음 한 번만 기록 (ms, timeOrigin 기준) */
export function markStartup(name: StartupMark): void {
  if (typeof window === 'undefined') return
  if (marks[name] !== undefined) return
  marks[name] = Math.round(performance.now())
}

function save(entry: StartupEntry): void {
  try {
    const raw = localStorage.getItem(STARTUP_TRACE_KEY)
    const list = raw ? (JSON.parse(raw) as StartupEntry[]) : []
    list.unshift(entry)
    localStorage.setItem(STARTUP_TRACE_KEY, JSON.stringify(list.slice(0, MAX_ENTRIES)))
  } catch { /* ignore */ }
}

export function readStartupTrace(): StartupEntry[] {
  try {
    const raw = localStorage.getItem(STARTUP_TRACE_KEY)
    return raw ? (JSON.parse(raw) as StartupEntry[]) : []
  } catch { return [] }
}

export function clearStartupTrace(): void {
  try { localStorage.removeItem(STARTUP_TRACE_KEY) } catch { /* ignore */ }
}

/** (main) 레이아웃이 마운트될 때 한 번 호출 */
export function startStartupTrace(): void {
  if (typeof window === 'undefined' || started) return
  started = true
  markStartup('hydrated')

  try {
    const po = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.startTime > FINALIZE_MS) continue
        longTaskMs += e.duration
        longTaskCount += 1
      }
    })
    po.observe({ type: 'longtask', buffered: true })
    setTimeout(() => po.disconnect(), FINALIZE_MS + 500)
  } catch { /* longtask 미지원 브라우저 */ }

  const wait = Math.max(0, FINALIZE_MS - performance.now())
  setTimeout(() => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    const fcp = performance.getEntriesByName('first-contentful-paint')[0]
    const scripts = (performance.getEntriesByType('resource') as PerformanceResourceTiming[])
      .filter((r) => r.initiatorType === 'script' && r.startTime < FINALIZE_MS)
    save({
      at: Date.now(),
      kind: 'cold',
      path: location.pathname,
      navType: nav?.type,
      sw: nav ? nav.workerStart > 0 : undefined,
      discarded: (document as Document & { wasDiscarded?: boolean }).wasDiscarded,
      html: nav ? Math.round(nav.responseStart) : undefined,
      dcl: nav ? Math.round(nav.domContentLoadedEventEnd) : undefined,
      fcp: fcp ? Math.round(fcp.startTime) : undefined,
      marks: { ...marks },
      longTaskMs: Math.round(longTaskMs),
      longTaskCount,
      jsKB: Math.round(scripts.reduce((s, r) => s + (r.decodedBodySize || 0), 0) / 1024),
      jsFiles: scripts.length,
      jsFromNetwork: scripts.filter((r) => r.transferSize > 0).length,
    })
  }, wait)

  // 메모리에 남아 있던 페이지를 다시 보여준 경우 — 다시 그리지 않으므로 숫자는 없고 '얼마나 숨어 있었나'만
  let hiddenAt: number | null = document.visibilityState === 'hidden' ? Date.now() : null
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now()
    } else if (hiddenAt !== null) {
      const min = (Date.now() - hiddenAt) / 60000
      hiddenAt = null
      if (min >= 1) save({ at: Date.now(), kind: 'resume', path: location.pathname, hiddenMin: Math.round(min), marks: {} })
    }
  })
}
