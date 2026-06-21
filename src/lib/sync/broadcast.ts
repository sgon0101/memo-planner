/**
 * 같은 브라우저 멀티탭 동기화 — BroadcastChannel API.
 *
 * 왜:
 *   - 두 탭으로 같은 메모/플랜을 열고 한쪽에서 수정하면 다른 쪽 stale.
 *   - Supabase Realtime은 비용 + 네트워크 round-trip이 있고, 같은 브라우저에선
 *     BroadcastChannel이 거의 무비용 + 즉시.
 *
 * 사용:
 *   write 직후:  broadcast({ type: 'memo-update', id, patch, updated_at })
 *   listener:    useBroadcastListener((e) => { ... })
 *
 * Note:
 *   - 자기 자신이 발신한 메시지는 같은 탭에 다시 안 옴 (브라우저 기본 동작).
 *   - 시크릿/구형 브라우저(BroadcastChannel 미지원)에서는 silent no-op.
 */

'use client'

import type { Memo, Plan, Folder } from '@/types'

const CHANNEL_NAME = 'weave-sync'

export type SyncEvent =
  | { type: 'memo-update';   id: string; patch: Partial<Memo>;   updated_at: string }
  | { type: 'memo-create';   memo: Memo }
  | { type: 'memo-delete';   id: string }
  | { type: 'plan-update';   id: string; patch: Partial<Plan>;   updated_at: string }
  | { type: 'plan-create';   plan: Plan }
  | { type: 'plan-delete';   id: string }
  | { type: 'folder-update'; id: string; patch: Partial<Folder>; updated_at: string }
  | { type: 'folder-create'; folder: Folder }
  | { type: 'folder-delete'; id: string }
  /** 무엇이 바뀐지 구체적이지 않을 때 — 단순히 React Query 키 invalidate 신호 */
  | { type: 'invalidate';    queryKey: (string | number | boolean)[] }

let channel: BroadcastChannel | null = null
let channelAvailable: boolean | null = null

function getChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined') return null
  if (channelAvailable === false) return null

  if (channel) return channel

  try {
    channel = new BroadcastChannel(CHANNEL_NAME)
    channelAvailable = true
    return channel
  } catch {
    channelAvailable = false
    return null
  }
}

/** write 직후 호출 — 같은 브라우저의 다른 탭들에 전파 */
export function broadcast(event: SyncEvent): void {
  const ch = getChannel()
  if (!ch) return
  try {
    ch.postMessage(event)
  } catch {
    // serialize 불가 등 — silent
  }
}

/** subscribe — return된 함수로 unsubscribe */
export function onBroadcast(handler: (event: SyncEvent) => void): () => void {
  const ch = getChannel()
  if (!ch) return () => {}

  const fn = (e: MessageEvent<SyncEvent>) => {
    try { handler(e.data) } catch { /* listener 에러는 다른 listener에 영향 안 줌 */ }
  }
  ch.addEventListener('message', fn)
  return () => ch.removeEventListener('message', fn)
}

/** 테스트/HMR 정리용 */
export function disposeBroadcast(): void {
  channel?.close()
  channel = null
  channelAvailable = null
}
