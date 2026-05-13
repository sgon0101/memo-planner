const CACHE_NAME = 'memo-planner-v2'
const STATIC_ASSETS = ['/', '/memo', '/planner', '/insights', '/settings']

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

  // same-origin 요청만 처리 — cross-origin(R2, Supabase 등)은 SW 미개입
  if (!url.startsWith(self.location.origin)) return

  // API 요청은 캐시하지 않음
  if (url.includes('/api/')) return

  event.respondWith(
    fetch(event.request)
      .catch(() => caches.match(event.request))
  )
})
