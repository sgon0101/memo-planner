/**
 * 홈 화면 앱 셸 캐시 (2026-11-15).
 *
 * sw.js가 `/home` HTML을 이 캐시에 저장해 두고, 앱을 열 때 서버(콜드 스타트·토큰 갱신)를 기다리지 않고
 * 바로 띄운다(stale-while-revalidate). 이 모듈은 브라우저 쪽 헬퍼 — 캐시 이름은 sw.js의 SHELL_CACHE와 같아야 한다.
 *
 * - 저장된 셸에는 사이드바의 이름·이메일이 들어 있으므로 로그아웃·로그인 화면 진입 시 지운다.
 * - 셸 HTML의 <meta name="weave-build">로 '더 새 버전을 받아 뒀는지'를 판단한다.
 */

export const SHELL_CACHE = 'weave-shell-v1'

/** 셸로 저장해 두는 화면 — public/sw.js의 SHELL_PATHS와 같아야 한다 */
export const SHELL_PATHS = ['/home', '/memo', '/planner', '/graph', '/insights', '/settings']

/** 지금 실행 중인 코드의 빌드 시각(ms). next.config가 빌드 때 주입, dev는 0 */
export const BUILD_TIME = Number(process.env.NEXT_PUBLIC_BUILD_TIME || 0)

export async function clearHomeShell(): Promise<void> {
  try {
    if (typeof caches !== 'undefined') await caches.delete(SHELL_CACHE)
  } catch {
    /* 캐시 접근 불가(사파리 사생활 보호 모드 등) — 무시 */
  }
}

/** 저장된 셸의 빌드 시각. 셸이 없거나 읽을 수 없으면 null */
export async function readShellBuildTime(): Promise<number | null> {
  try {
    if (typeof caches === 'undefined') return null
    const cache = await caches.open(SHELL_CACHE)
    const res = await cache.match('/home')
    if (!res) return null
    const html = await res.text()
    const m = html.match(/<meta name="weave-build" content="(\d+)"/)
    return m ? Number(m[1]) : null
  } catch {
    return null
  }
}

/**
 * 셸을 브라우저에서 직접 새로 받아 저장한다.
 * 서비스워커가 꺼져 있을 때는 sw.js 정적 라우팅이 캐시에서 바로 꺼내 주므로 sw.js의 뒤 갱신이 돌지 않는다
 * → 그 경우에만 페이지가 대신 갱신한다. 로그인 화면으로 보내는 응답이면 셸을 지우고 'auth-lost'를 돌려준다.
 */
export async function refreshShell(path: string): Promise<'ok' | 'auth-lost' | 'skip'> {
  try {
    if (typeof caches === 'undefined') return 'skip'
    if (!SHELL_PATHS.includes(path)) return 'skip'
    const res = await fetch(path, { redirect: 'manual', credentials: 'same-origin', cache: 'no-store' })
    if (res.type === 'opaqueredirect' || res.redirected || res.status === 401) {
      await clearHomeShell()
      return 'auth-lost'
    }
    if (!res.ok || !(res.headers.get('content-type') || '').includes('text/html')) return 'skip'
    const headers = new Headers(res.headers)
    headers.set('x-weave-cached-at', String(Date.now()))
    // 정적 라우팅은 실제 탐색 요청으로 캐시를 찾으므로 Vary(RSC·Accept-Encoding 등) 때문에 빗나가지 않게 뺀다
    headers.delete('vary')
    const body = await res.blob()
    const cache = await caches.open(SHELL_CACHE)
    await cache.put(path, new Response(body, { status: res.status, statusText: res.statusText, headers }))
    return 'ok'
  } catch {
    return 'skip'
  }
}

/** 저장된 셸이 없거나 지금 실행 중인 빌드보다 옛 빌드면 true */
export async function shellNeedsRefresh(path: string): Promise<boolean> {
  try {
    if (typeof caches === 'undefined' || !SHELL_PATHS.includes(path)) return false
    const res = await (await caches.open(SHELL_CACHE)).match(path)
    if (!res) return true
    const m = (await res.text()).match(/<meta name="weave-build" content="(\d+)"/)
    return !m || Number(m[1]) < BUILD_TIME
  } catch {
    return false
  }
}

/**
 * 저장된 셸 HTML이 쓰는 앱 코드 파일(_next/static/chunks/*.js)을 미리 받아 둔다 (2026-11-17).
 * 탭을 처음 누를 때 그 화면의 코드 파일을 내려받느라 기다리던 것(0.3초 안팎, 느린 회선이면 더)을 없앤다.
 * 서비스워커가 _next/static을 받으면서 캐시에 넣으므로, 이미 받아 둔 파일은 건너뛴다.
 */
export async function preloadShellChunks(path: string): Promise<void> {
  try {
    if (typeof caches === 'undefined') return
    const res = await (await caches.open(SHELL_CACHE)).match(path)
    if (!res) return
    const html = await res.text()
    const srcs = new Set<string>()
    for (const m of html.matchAll(/\/_next\/static\/chunks\/[^"'\s\\]+\.js/g)) srcs.add(m[0])
    const names = await caches.keys()
    const staticCache = names.find((n) => n.startsWith('memo-planner-'))
    const cache = staticCache ? await caches.open(staticCache) : null
    for (const src of srcs) {
      if (cache && (await cache.match(src))) continue
      await fetch(src, { credentials: 'same-origin' }).catch(() => {})
    }
  } catch {
    /* 실패해도 탭을 누를 때 원래대로 받는다 */
  }
}
