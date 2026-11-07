'use client'

import { useEffect } from 'react'

export default function ServiceWorkerRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    if (process.env.NODE_ENV !== 'production') {
      // 개발 서버(Turbopack)의 _next/static 청크는 콘텐츠 해시가 없어 같은 URL로 내용이 바뀐다.
      // sw.js의 cache-first가 옛 청크를 계속 내주면 코드 수정이 반영되지 않고(ChunkLoadError·offline 화면까지)
      // 보이므로, dev에서는 등록하지 않고 이전에 등록된 SW·캐시도 정리한다.
      navigator.serviceWorker.getRegistrations()
        .then((regs) => Promise.all(regs.map((r) => r.unregister())))
        .then(() => (typeof caches !== 'undefined' ? caches.keys() : []))
        .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
        .catch(() => {})
      return
    }
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  }, [])

  return null
}
