const CACHE_NAME = 'memo-planner-v5'
// 홈 앱 셸(2026-11-15) — /home HTML을 저장해 두고 앱을 열 때 서버를 기다리지 않고 바로 띄운다.
// 이름은 src/lib/pwa/homeShell.ts의 SHELL_CACHE와 같아야 한다(로그아웃 시 브라우저가 지움).
const SHELL_CACHE = 'weave-shell-v1'
// 저장해 두고 바로 여는 화면(검색 파라미터 없는 주소만). 안드로이드는 앱을 메모리에서 지운 뒤에도 마지막에 보던
// 주소로 다시 열기 때문에 홈만 저장하면 다른 화면으로 열릴 때 서버를 기다렸다(2026-11-17, 실측 2~2.7초).
// src/lib/pwa/homeShell.ts의 SHELL_PATHS와 같아야 한다.
const SHELL_PATHS = ['/home', '/memo', '/planner', '/graph', '/insights', '/settings']
const SHELL_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000 // 일주일 넘게 안 열었으면 서버 응답을 기다린다
// M2: offline.html도 precache — HTML navigation fallback shell
const STATIC_ASSETS = ['/manifest.json', '/offline.html']

self.addEventListener('install', (event) => {
  // 정적 라우팅(Chrome 123+, 2026-11-15) — 몇 시간 뒤 앱을 열면 폰이 서비스워커를 내려 둔 상태라
  // 다시 깨우는 데 1초 넘게 걸렸다(실측 화면 틀 도착 1.64초 vs 깨어 있을 때 0.33초).
  // 서비스워커가 꺼져 있을 때만 홈 셸과 앱 코드(_next/static)를 브라우저가 캐시에서 바로 꺼내게 한다.
  // 캐시에 없으면 브라우저가 네트워크로 받는다. 깨어 있을 때는 아래 fetch 처리(갱신·로그인 끊김 감지)를 그대로 쓴다.
  if (typeof event.addRoutes === 'function' && typeof URLPattern === 'function') {
    try {
      event.addRoutes([
        ...SHELL_PATHS.map((pathname) => ({
          condition: {
            urlPattern: new URLPattern({ pathname, search: '', baseURL: self.location.origin }),
            requestMode: 'navigate',
            runningStatus: 'not-running',
          },
          source: { cacheName: SHELL_CACHE },
        })),
        {
          condition: {
            urlPattern: new URLPattern({ pathname: '/_next/static/*', baseURL: self.location.origin }),
            runningStatus: 'not-running',
          },
          source: { cacheName: CACHE_NAME },
        },
      ])
    } catch (_) { /* 미지원·형식 오류면 기존 방식 그대로 */ }
  }
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).catch(() => {})
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME && k !== SHELL_CACHE).map((k) => caches.delete(k)))
    )
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const url = event.request.url

  // cross-origin(R2, Supabase 등)은 SW 미개입
  if (!url.startsWith(self.location.origin)) return

  // API 요청은 캐시하지 않음
  if (url.includes('/api/')) return

  // _next/static: Cache-first (콘텐츠 해시 버저닝으로 stale 없음)
  if (url.includes('/_next/static/')) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(event.request)
        if (cached) return cached
        try {
          const response = await fetch(event.request)
          if (response.ok) cache.put(event.request, response.clone())
          return response
        } catch (_e) {
          // 네트워크 실패 → 503으로 graceful fallback (Response 미반환 시 TypeError 방지)
          return new Response('Offline', { status: 503, statusText: 'Service Unavailable' })
        }
      })
    )
    return
  }

  // 정적 파일(아이콘, manifest): Cache-first
  if (
    url.includes('/icons/') ||
    url.includes('/images/') ||
    url.endsWith('/manifest.json') ||
    url.endsWith('/favicon.ico')
  ) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(event.request)
        if (cached) return cached
        try {
          const response = await fetch(event.request)
          if (response.ok) cache.put(event.request, response.clone())
          return response
        } catch (_e) {
          // 네트워크 실패 → 503으로 graceful fallback (Response 미반환 시 TypeError 방지)
          return new Response('Offline', { status: 503, statusText: 'Service Unavailable' })
        }
      })
    )
    return
  }

  // 주요 화면 진입: 저장된 셸을 바로 띄우고 뒤에서 최신 셸을 받는다 (stale-while-revalidate)
  if (event.request.mode === 'navigate') {
    const u = new URL(url)
    if (SHELL_PATHS.includes(u.pathname) && !u.search) {
      event.respondWith(serveShell(event, u.pathname))
      return
    }
  }

  // HTML 페이지: Network-first (auth 상태·동적 콘텐츠 반영)
  // 실패 시 순서대로 fallback: (1) 정확한 URL 캐시 → (2) offline.html 셸 → (3) 503 텍스트
  event.respondWith(
    (async () => {
      try {
        const netRes = await fetch(event.request)
        // 자연스러운 캐시 — 다음 오프라인 진입 시 정확한 URL 그대로 진입 가능
        if (netRes.ok) {
          try { const c = await caches.open(CACHE_NAME); c.put(event.request, netRes.clone()) } catch (_) {}
        }
        return netRes
      } catch (_e) {
        // 정확한 URL 캐시가 있으면 그거
        const exact = await caches.match(event.request)
        if (exact) return exact
        // 없으면 offline shell — 사용자에게 친절한 UI 제공
        const shell = await caches.match('/offline.html')
        if (shell) return shell
        return new Response('Offline', {
          status: 503,
          statusText: 'Service Unavailable',
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        })
      }
    })()
  )
})

async function notifyClients(type) {
  try {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    list.forEach((c) => c.postMessage({ type }))
  } catch (_) {}
}

async function serveShell(event, path) {
  const cache = await caches.open(SHELL_CACHE)
  const cached = await cache.match(path)
  const cachedAt = cached ? Number(cached.headers.get('x-weave-cached-at') || 0) : 0
  const useCached = !!cached && Date.now() - cachedAt < SHELL_MAX_AGE_MS

  const network = fetch(event.request).then(async (res) => {
    // 로그인 화면으로 보내는 응답(proxy 리디렉트) → 저장된 셸은 더 쓰면 안 된다
    if (res.type === 'opaqueredirect' || res.redirected || res.status === 401) {
      await caches.delete(SHELL_CACHE) // 이름·이메일이 든 다른 화면 셸도 함께 지운다
      if (useCached) await notifyClients('weave-auth-lost')
      return res
    }
    const isHtml = (res.headers.get('content-type') || '').includes('text/html')
    if (res.ok && isHtml) {
      try {
        const headers = new Headers(res.headers)
        headers.set('x-weave-cached-at', String(Date.now()))
        // 정적 라우팅은 실제 탐색 요청으로 캐시를 찾으므로 Vary(RSC·Accept-Encoding 등) 때문에 빗나가지 않게 뺀다
        headers.delete('vary')
        const body = await res.clone().blob()
        await cache.put(path, new Response(body, { status: res.status, statusText: res.statusText, headers }))
      } catch (_) {}
    }
    return res
  })

  if (useCached) {
    event.waitUntil(network.catch(() => {}))
    return cached
  }
  try {
    return await network
  } catch (_e) {
    if (cached) return cached
    const shell = await caches.match('/offline.html')
    if (shell) return shell
    return new Response('Offline', { status: 503, statusText: 'Service Unavailable', headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
  }
}

/* ────────────────────────────────────────────────────────── */
/* Web Push (#6-B) + 액션 버튼 (스누즈/완료)                  */
/* ────────────────────────────────────────────────────────── */

// 서버에서 보낸 push 메시지 수신 → 알림 표시
self.addEventListener('push', (event) => {
  let payload = {}
  if (event.data) {
    try {
      payload = event.data.json()
    } catch (_e) {
      payload = { title: 'weave', body: event.data.text() }
    }
  }
  const title = payload.title || 'weave'
  // 액션 버튼 — planId/planDate 있을 때만 제공 (테스트/일반 알림엔 미노출)
  const hasPlanCtx = payload.data && payload.data.planId && payload.data.planDate
  const actions = hasPlanCtx
    ? [
        { action: 'snooze', title: '10분 후 다시' },
        { action: 'complete', title: '완료' },
      ]
    : []
  const options = {
    body: payload.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: payload.tag || undefined,
    data: { url: payload.url || '/', ...(payload.data || {}) },
    vibrate: [60, 30, 60],
    actions,
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

// 액션 버튼 처리 — 현재 push subscription의 endpoint로 서버에 user 식별
async function postWithEndpoint(url, body) {
  try {
    const sub = await self.registration.pushManager.getSubscription()
    const endpoint = sub ? sub.endpoint : null
    if (!endpoint) return false
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, endpoint }),
    })
    return res.ok
  } catch (_e) {
    return false
  }
}

// 알림 클릭 시 — 액션이면 API 호출, 본문이면 앱 열기
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const data = event.notification.data || {}
  const { url, planId, planDate } = data

  // 액션: 스누즈 — 10분 후 다시 알림
  if (event.action === 'snooze') {
    event.waitUntil((async () => {
      const ok = await postWithEndpoint('/api/notifications/snooze', { planId, planDate })
      if (ok) {
        await self.registration.showNotification('⏰ 10분 후 다시 알려드릴게요', {
          body: '',
          icon: '/icon-192.png',
          badge: '/icon-192.png',
          tag: 'weave-snooze-ack',
          silent: true,
          requireInteraction: false,
        })
      }
    })())
    return
  }

  // 액션: 완료 — 플랜 완료 처리
  if (event.action === 'complete') {
    event.waitUntil((async () => {
      const ok = await postWithEndpoint('/api/notifications/complete', { planId, planDate })
      if (ok) {
        await self.registration.showNotification('✅ 완료 처리됐어요', {
          body: '',
          icon: '/icon-192.png',
          badge: '/icon-192.png',
          tag: 'weave-complete-ack',
          silent: true,
          requireInteraction: false,
        })
      }
    })())
    return
  }

  // 본문 클릭 — 앱 탭으로 navigate 또는 새 창
  const targetUrl = url || '/'
  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of allClients) {
      if (client.url.startsWith(self.location.origin)) {
        try { await client.navigate(targetUrl) } catch (_e) { /* navigate 불가 시 무시 */ }
        return client.focus()
      }
    }
    if (self.clients.openWindow) {
      return self.clients.openWindow(targetUrl)
    }
  })())
})

// subscription이 만료/재발급된 경우 — 서버에 재등록 시도
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    try {
      const newSub = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: (event.oldSubscription && event.oldSubscription.options && event.oldSubscription.options.applicationServerKey) || null,
      })
      await fetch('/api/notifications/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSub.toJSON()),
      })
    } catch (_e) { /* 재등록 실패 — 사용자가 다시 토글하면 새로 시도 */ }
  })())
})
