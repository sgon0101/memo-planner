'use client'

/**
 * 홈 화면 앱 셸(sw.js stale-while-revalidate)의 뒤처리 (2026-11-15).
 *
 * ① 로그인 끊김: 저장된 셸을 띄운 뒤 서버가 '로그인 필요'로 답하면 sw.js가 'weave-auth-lost'를 보낸다 →
 *    로그인 화면으로. Supabase가 갱신 실패로 SIGNED_OUT을 내도 같은 처리(이중 안전장치).
 * ② 새 버전: 뒤에서 받아 둔 셸이 지금 코드보다 새 빌드면 —
 *    앱을 다시 화면에 띄울 때(백그라운드 → 복귀) 편집 중이 아니면 조용히 새로고침,
 *    그 외에는 '새 버전이 있어요 · 새로고침' 안내(1회).
 * ③ 배포 직후 옛 셸이 서버에 없는 화면 파일을 요청해 실패하면(ChunkLoadError) 셸을 지우고 1회 새로고침.
 */

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { toast } from '@/components/ui/Toast'
import { BUILD_TIME, clearHomeShell, readShellBuildTime } from '@/lib/pwa/homeShell'

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
