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
