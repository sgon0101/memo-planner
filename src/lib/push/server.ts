/**
 * Web Push 서버 헬퍼 (#6-B)
 *
 * - 환경변수에서 VAPID 키 로드 + web-push 라이브러리 초기화
 * - sendPushTo(subscription, payload) — 단일 subscription에 발송
 * - 410/404 응답 시 expired로 분류 → 호출 측에서 DB 정리
 *
 * 환경변수:
 *   NEXT_PUBLIC_VAPID_PUBLIC_KEY — 클라이언트에서도 사용
 *   VAPID_PRIVATE_KEY            — 서버 only
 *   VAPID_SUBJECT                — 'mailto:...' 또는 'https://...'
 */

import webpush from 'web-push'

let initialized = false

function ensureVapid() {
  if (initialized) return
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT || 'mailto:noreply@weave.local'
  if (!publicKey || !privateKey) {
    throw new Error('VAPID 키가 환경변수에 설정되지 않았습니다 (NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY).')
  }
  webpush.setVapidDetails(subject, publicKey, privateKey)
  initialized = true
}

export interface PushSubscriptionRow {
  endpoint: string
  p256dh: string
  auth: string
}

export interface PushPayload {
  title: string
  body: string
  /** 알림 클릭 시 열 페이지 (예: '/planner?date=2026-05-26') */
  url?: string
  /** 동일 tag면 같은 알림이 교체됨 (중복 방지) */
  tag?: string
  /** 추가 데이터 — service worker 측에서 사용 가능 */
  data?: Record<string, unknown>
}

export type SendResult =
  | { ok: true }
  | { ok: false; expired: true }   // subscription이 만료/취소됨 → DB에서 제거 필요
  | { ok: false; expired: false; error: string }

export async function sendPushTo(
  sub: PushSubscriptionRow,
  payload: PushPayload,
): Promise<SendResult> {
  ensureVapid()
  const subscription = {
    endpoint: sub.endpoint,
    keys: { p256dh: sub.p256dh, auth: sub.auth },
  }
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload))
    return { ok: true }
  } catch (err: unknown) {
    const e = err as { statusCode?: number; body?: string; message?: string }
    const code = e.statusCode
    // 410 Gone / 404 Not Found = subscription 만료/취소
    if (code === 410 || code === 404) {
      return { ok: false, expired: true }
    }
    return { ok: false, expired: false, error: e.message ?? String(err) }
  }
}
