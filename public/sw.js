const CACHE_NAME = 'memo-planner-v3'
const STATIC_ASSETS = ['/manifest.json']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).catch(() => {})
  )
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
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
        const response = await fetch(event.request)
        if (response.ok) cache.put(event.request, response.clone())
        return response
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
        const response = await fetch(event.request)
        if (response.ok) cache.put(event.request, response.clone())
        return response
      })
    )
    return
  }

  // HTML 페이지: Network-first (auth 상태·동적 콘텐츠 반영)
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  )
})

/* ────────────────────────────────────────────────────────── */
/* Web Push (#6-B)                                            */
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
  const options = {
    body: payload.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: payload.tag || undefined,         // 같은 tag면 알림이 교체됨 (중복 방지)
    data: { url: payload.url || '/', ...(payload.data || {}) },
    vibrate: [60, 30, 60],
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

// 알림 클릭 시 — 앱 탭이 있으면 그 탭으로 focus, 없으면 새 창 열기
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    // 같은 origin의 탭이 있으면 navigate + focus
    for (const client of allClients) {
      if (client.url.startsWith(self.location.origin)) {
        try { await client.navigate(targetUrl) } catch (_e) { /* navigate 불가 시 무시 */ }
        return client.focus()
      }
    }
    // 없으면 새 창
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
