'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useDarkModeValue } from '@/store/uiStore'
import { GoogleIcon } from '@/components/auth/AuthControls'

/**
 * Google 로그인 — 원탭 + Google 공식 버튼 (2026-11-14)
 *
 * 예전 방식(signInWithOAuth)은 Google 계정 선택 화면에 `xxx.supabase.co로 이동` 이라는
 * 낯선 주소가 보이고, 페이지를 두 번 오갔다. 이 컴포넌트는 Google Identity Services(GIS)로
 * 같은 화면 위에서 ID 토큰을 받아 Supabase signInWithIdToken으로 바로 로그인한다.
 *
 * 보안: nonce — 원문은 메모리에만 두고 Google에는 SHA-256 해시를 넘긴다. Supabase가
 * 토큰 속 해시와 원문을 대조하므로, 가로챈 토큰을 다른 곳에서 재사용할 수 없다.
 *
 * 폴백: 클라이언트 ID가 없거나 GIS 스크립트가 4초 안에 준비되지 않으면 기존 OAuth 버튼을 보여준다.
 * 원탭 창은 Google이 표시 여부를 정한다(닫으면 한동안 안 뜸) — 그래서 버튼은 항상 함께 둔다.
 */

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? ''
const GSI_SRC = 'https://accounts.google.com/gsi/client'
const LOAD_TIMEOUT_MS = 4000

interface GsiCredentialResponse { credential?: string }
interface GsiApi {
  initialize: (cfg: Record<string, unknown>) => void
  renderButton: (el: HTMLElement, opts: Record<string, unknown>) => void
  prompt: () => void
  cancel: () => void
}
declare global {
  interface Window { google?: { accounts?: { id?: GsiApi } } }
}

let gsiPromise: Promise<GsiApi> | null = null
function loadGsi(): Promise<GsiApi> {
  if (window.google?.accounts?.id) return Promise.resolve(window.google.accounts.id)
  if (gsiPromise) return gsiPromise
  gsiPromise = new Promise<GsiApi>((resolve, reject) => {
    const timer = setTimeout(() => { gsiPromise = null; reject(new Error('gsi timeout')) }, LOAD_TIMEOUT_MS)
    const done = () => {
      const api = window.google?.accounts?.id
      clearTimeout(timer)
      if (api) resolve(api)
      else { gsiPromise = null; reject(new Error('gsi missing')) }
    }
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SRC}"]`)
    if (existing) { existing.addEventListener('load', done, { once: true }); return }
    const s = document.createElement('script')
    s.src = GSI_SRC
    s.async = true
    s.onload = done
    s.onerror = () => { clearTimeout(timer); gsiPromise = null; reject(new Error('gsi load error')) }
    document.head.appendChild(s)
  })
  return gsiPromise
}

async function makeNonce(): Promise<{ raw: string; hashed: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const raw = btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, '')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))
  const hashed = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
  return { raw, hashed }
}

interface Props {
  mode: 'signin' | 'signup'
  /** 다른 동작(이메일 로그인 등)이 진행 중일 때 버튼을 막는다 */
  disabled?: boolean
  onError: (message: string) => void
  /** 로그인 성공 후 이동할 경로 */
  successPath?: string
}

export default function GoogleSignIn({ mode, disabled, onError, successPath = '/memo' }: Props) {
  const router = useRouter()
  const dark = useDarkModeValue()
  const boxRef = useRef<HTMLDivElement>(null)
  const nonceRef = useRef<string>('')
  const onErrorRef = useRef(onError)
  useEffect(() => { onErrorRef.current = onError })
  // 'loading' → GIS 준비 중(자리만 잡음), 'gis' → 공식 버튼, 'fallback' → 기존 OAuth 버튼
  const [status, setStatus] = useState<'loading' | 'gis' | 'fallback'>(CLIENT_ID ? 'loading' : 'fallback')
  const [busy, setBusy] = useState(false)

  const handleCredential = useCallback(async (res: GsiCredentialResponse) => {
    if (!res.credential) return
    setBusy(true)
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithIdToken({
      provider: 'google',
      token: res.credential,
      nonce: nonceRef.current,
    })
    if (error) {
      console.error('[auth:google-idtoken]', error.message)
      setBusy(false)
      onErrorRef.current('Google 로그인을 마치지 못했어요. 아래 버튼으로 다시 시도해주세요.')
      setStatus('fallback') // 같은 실패가 반복되지 않게 기존 방식으로 전환
      return
    }
    router.push(successPath)
    router.refresh()
  }, [router, successPath])

  // GIS 준비 → 초기화 → 버튼 그리기 (+ 로그인 화면이면 원탭 창)
  useEffect(() => {
    if (!CLIENT_ID || status === 'fallback') return
    let cancelled = false
    ;(async () => {
      try {
        const [api, nonce] = await Promise.all([loadGsi(), makeNonce()])
        if (cancelled || !boxRef.current) return
        nonceRef.current = nonce.raw
        api.initialize({
          client_id: CLIENT_ID,
          callback: handleCredential,
          nonce: nonce.hashed,
          context: mode === 'signup' ? 'signup' : 'signin',
          ux_mode: 'popup',
          auto_select: mode === 'signin', // 이전에 로그인한 계정이 하나뿐이면 원탭에서 자동 로그인
          itp_support: true,
          use_fedcm_for_prompt: true,
        })
        const width = Math.min(Math.max(boxRef.current.clientWidth, 200), 400)
        boxRef.current.innerHTML = ''
        api.renderButton(boxRef.current, {
          type: 'standard',
          theme: dark ? 'filled_black' : 'outline',
          size: 'large',
          text: mode === 'signup' ? 'signup_with' : 'signin_with',
          shape: 'rectangular',
          logo_alignment: 'center',
          locale: 'ko',
          width,
        })
        setStatus('gis')
        if (mode === 'signin') api.prompt()
      } catch (e) {
        if (cancelled) return
        console.error('[auth:google-gsi]', e instanceof Error ? e.message : e)
        setStatus('fallback')
      }
    })()
    return () => {
      cancelled = true
      window.google?.accounts?.id?.cancel()
    }
  // status는 'fallback' 전환 시 정리만 하면 되므로 의존성에서 뺀다 (gis로 바뀔 때 재실행 방지)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, dark, handleCredential])

  // 폴백: 기존 리디렉트 방식. prompt:'consent'는 쓰지 않는다 — 매번 동의 화면을 강제할 뿐
  // 그 토큰(provider_token)을 앱 어디에서도 쓰지 않는다(Drive·Calendar는 별도 연결 흐름).
  async function handleOAuth() {
    setBusy(true)
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
    if (error) {
      setBusy(false)
      onErrorRef.current('Google 로그인 중 오류가 발생했습니다.')
    }
  }

  const label = mode === 'signup' ? 'Google로 시작하기' : 'Google로 로그인'

  return (
    <div className="relative">
      {/* GIS 버튼 자리 — 준비 전엔 같은 높이의 자리만 잡아 화면이 출렁이지 않게 */}
      <div
        ref={boxRef}
        aria-busy={status === 'loading' || busy}
        className={status === 'fallback' ? 'hidden' : 'flex justify-center min-h-[44px]'}
        style={busy || disabled ? { pointerEvents: 'none', opacity: 0.5 } : undefined}
      />
      {status === 'loading' && (
        <div className="absolute inset-0 rounded-lg border border-gray-200 dark:border-gray-700 animate-pulse" aria-hidden />
      )}
      {status === 'fallback' && (
        <button
          type="button"
          onClick={handleOAuth}
          disabled={busy || disabled}
          className="w-full flex items-center justify-center gap-2.5 py-2.5 px-4 border border-gray-300 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-sm font-medium text-gray-700 dark:text-gray-300 disabled:opacity-50"
        >
          <GoogleIcon />
          {busy ? '연결 중...' : label}
        </button>
      )}
      {busy && status === 'gis' && (
        <p className="mt-2 text-center text-xs text-gray-500 dark:text-gray-400" role="status">로그인하는 중…</p>
      )}
    </div>
  )
}
