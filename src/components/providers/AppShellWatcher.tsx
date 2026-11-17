'use client'

/**
 * 홈 화면 앱 셸(sw.js stale-while-revalidate)의 뒤처리 (2026-11-15).
 *
 * ① 로그인 끊김: 저장된 셸을 띄운 뒤 서버가 '로그인 필요'로 답하면 sw.js가 'weave-auth-lost'를 보낸다 →
 *    로그인 화면으로. 알림을 놓칠 수 있어 시작할 때 getSession()으로 직접도 확인하고, SIGNED_OUT도 같은 처리.
 * ② 새 버전: 뒤에서 받아 둔 셸이 지금 코드보다 새 빌드면 —
 *    앱을 다시 화면에 띄울 때(백그라운드 → 복귀) 편집 중이 아니면 조용히 새로고침,
 *    그 외에는 '새 버전이 있어요 · 새로고침' 안내(1회).
 * ③ 배포 직후 옛 셸이 서버에 없는 화면 파일을 요청해 실패하면(ChunkLoadError) 셸을 지우고 1회 새로고침.
 */

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from '@/components/ui/Toast'
import { usePathname } from 'next/navigation'
import { BUILD_TIME, clearHomeShell, readShellBuildTime, refreshShell, shellNeedsRefresh, SHELL_PATHS } from '@/lib/pwa/homeShell'
import { startStartupTrace } from '@/lib/perf/startupTrace'

const CHUNK_RELOAD_KEY = 'weave:chunk-reload-at'
const UPDATE_RELOAD_KEY = 'weave:update-reloaded-for'

function goLogin() {
  if (window.location.pathname.startsWith('/login')) return
  void clearHomeShell().finally(() => window.location.replace('/login'))
}

/** 글을 쓰는 중이면 자동 새로고침하지 않는다 */
function isEditing(): boolean {
  if (/^\/memo\/[^/]+/.test(window.location.pathname)) return true
  const el = document.activeElement as HTMLElement | null
  if (!el) return false
  return el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'
}

export function AppShellWatcher() {
  // 시작 속도 측정 (임시 진단)
  useEffect(() => { startStartupTrace() }, [])

  // ⓪ 서비스워커가 꺼져 있어 셸을 브라우저가 캐시에서 바로 꺼낸 경우(sw.js 정적 라우팅) — sw.js 대신 셸 갱신
  useEffect(() => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    if (!nav || nav.workerStart > 0) return
    if (!SHELL_PATHS.includes(location.pathname) || location.search) return
    if (!navigator.serviceWorker?.controller) return
    const path = location.pathname
    const t = setTimeout(() => {
      void refreshShell(path).then((r) => { if (r === 'auth-lost') goLogin() })
    }, 5000)
    return () => clearTimeout(t)
  }, [])

  // ⓪-2 앱 안에서 화면을 옮겼을 때 그 화면의 셸이 없거나 옛 빌드면 한 번 받아 둔다
  // (안드로이드가 앱을 다시 열 때 마지막 화면으로 열기 때문 — 그때 저장본이 있어야 바로 뜬다)
  const pathname = usePathname()
  useEffect(() => {
    if (!BUILD_TIME || !pathname || !SHELL_PATHS.includes(pathname)) return
    if (!navigator.serviceWorker?.controller) return
    const t = setTimeout(() => {
      if (location.pathname !== pathname || location.search) return
      void shellNeedsRefresh(pathname).then((need) => {
        if (need) void refreshShell(pathname).then((r) => { if (r === 'auth-lost') goLogin() })
      })
    }, 3000)
    return () => clearTimeout(t)
  }, [pathname])

  // ① 로그인 끊김
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === 'weave-auth-lost') goLogin()
    }
    navigator.serviceWorker?.addEventListener('message', onMessage)
    const supabase = createClient()
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') goLogin()
    })
    // sw.js 알림은 페이지가 듣기 전에 지나갈 수 있다(서버 응답이 빠를 때) → 시작할 때 직접 확인.
    // getSession()은 만료 토큰이면 갱신을 시도한다. 세션이 없고 오류도 없거나(로그아웃 상태) 4xx(토큰 폐기)일 때만
    // 로그인 화면으로 — 오프라인·5xx 같은 일시 오류에선 그대로 둔다(proxy와 같은 규칙).
    void supabase.auth.getSession().then(({ data, error }) => {
      if (data.session) return
      const status = (error as { status?: number } | null)?.status ?? 0
      if (!error || (status >= 400 && status < 500)) goLogin()
    }).catch(() => {})
    return () => {
      navigator.serviceWorker?.removeEventListener('message', onMessage)
      subscription.unsubscribe()
    }
  }, [])

  // ② 새 버전
  useEffect(() => {
    if (!BUILD_TIME) return // dev
    let notified = false
    let wasHidden = false

    const check = async (fromBackground: boolean) => {
      const shellBuild = await readShellBuildTime()
      if (!shellBuild || shellBuild <= BUILD_TIME) return
      // 같은 새 버전으로는 자동 새로고침을 한 번만 — 배포 되돌리기(rollback)처럼 서버가 저장본보다
      // 옛 버전을 주는 경우, 새로고침해도 버전이 안 바뀌어 화면 복귀 때마다 반복되는 것을 막는다
      let alreadyReloaded = false
      try { alreadyReloaded = sessionStorage.getItem(UPDATE_RELOAD_KEY) === String(shellBuild) } catch { /* 무시 */ }
      if (fromBackground && !isEditing() && !alreadyReloaded) {
        try { sessionStorage.setItem(UPDATE_RELOAD_KEY, String(shellBuild)) } catch { /* 무시 */ }
        window.location.reload()
        return
      }
      if (alreadyReloaded) return
      if (notified) return
      notified = true
      toast.info('새 버전이 있어요', {
        duration: 15000,
        action: { label: '새로고침', onClick: () => window.location.reload() },
      })
    }

    // 뒤에서 셸을 다시 받는 시간(서버 깨우기 포함)을 기다렸다가 확인
    const timer = window.setTimeout(() => void check(false), 6000)
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') { wasHidden = true; return }
      if (wasHidden) { wasHidden = false; void check(true) }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  // ③ 화면 파일 못 찾음 → 셸 지우고 1회 새로고침 (1분 안에 반복하지 않음)
  useEffect(() => {
    const CHUNK_RE = /ChunkLoadError|Loading chunk [\w-]+ failed|Failed to fetch dynamically imported module|Importing a module script failed/i
    const recover = (msg: string) => {
      if (!CHUNK_RE.test(msg)) return
      try {
        const last = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) || 0)
        if (Date.now() - last < 60_000) return
        sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()))
      } catch { /* sessionStorage 불가 — 그래도 1회 시도 */ }
      void clearHomeShell().finally(() => window.location.reload())
    }
    const onError = (e: ErrorEvent) => recover(`${e.message} ${e.error?.name ?? ''}`)
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason as { name?: string; message?: string } | undefined
      recover(`${r?.name ?? ''} ${r?.message ?? String(e.reason ?? '')}`)
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])

  return null
}
