/**
 * 메모 저장 후 자동 임베딩 트리거 (PR-6).
 *
 * 동작:
 *   - 사용된 메모 ID를 호출 → 백그라운드에서 /api/embeddings/generate 호출
 *   - debounce 5초 — 사용자가 연속 편집해도 마지막 1회만
 *   - fire-and-forget — 실패해도 사용자 흐름 방해 ✗
 *   - DB 측 트리거(0011)가 content_hash 변경 시 embedding을 NULL로 만들므로
 *     실제로 변경 있을 때만 OpenAI 호출됨 (서버 측 idempotent)
 *
 * 사용:
 *   const triggerEmbed = useAutoEmbed()
 *   // 메모 저장 직후
 *   triggerEmbed(memoId)
 */

'use client'

import { useCallback, useEffect, useRef } from 'react'

const DEBOUNCE_MS = 5_000

export function useAutoEmbed() {
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  // cleanup on unmount
  useEffect(() => {
    const timers = timersRef.current
    return () => {
      timers.forEach((t) => clearTimeout(t))
      timers.clear()
    }
  }, [])

  const trigger = useCallback((memoId: string) => {
    if (!memoId || memoId === 'new') return

    // 이미 예약된 타이머 있으면 reset
    const existing = timersRef.current.get(memoId)
    if (existing) clearTimeout(existing)

    const t = setTimeout(() => {
      timersRef.current.delete(memoId)
      // fire-and-forget
      fetch('/api/embeddings/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memoId }),
      }).catch((e) => {
        // 임베딩 실패는 사용자에게 노출하지 않음 — 다음 backfill에서 재시도
        console.warn('[weave:autoembed] failed', memoId, e instanceof Error ? e.message : e)
      })
    }, DEBOUNCE_MS)

    timersRef.current.set(memoId, t)
  }, [])

  return trigger
}
