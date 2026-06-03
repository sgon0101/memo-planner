const CACHE_NAME = 'memo-planner-v4'
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

  // HTML 페이지: Network-first (auth 상태·동적 콘텐츠 반영)
  // 네트워크 실패 + 캐시 미스 시 503 Response 반환 (Response 미반환 시 TypeError 발생 방지)
  event.respondWith(
    fetch(event.request)
      .catch(() => caches.match(event.request))
      .then((r) => r || new Response('Offline', {
        status: 503,
        statusText: 'Service Unavailable',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      }))
  )
})

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
