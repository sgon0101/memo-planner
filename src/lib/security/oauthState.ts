// OAuth state HMAC 서명/검증 — CSRF·계정 탈취 방지
// 기존에는 state에 user_id를 평문으로 실어 callback이 무검증 신뢰했음
// → 공격자가 임의 user_id로 자신의 Google 토큰을 등록해 연동을 가로챌 수 있었다.
// 이제 auth 라우트가 서명된 state를 발급하고, callback은 서명+만료를 검증한 뒤
// state 내부의 user_id만 사용한다. (DB 불필요, 서버리스 안전)

import { createHmac, randomBytes, timingSafeEqual } from 'crypto'

const STATE_TTL_MS = 10 * 60 * 1000 // 10분
const VERSION = 'v1'

function getSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET || process.env.ENCRYPTION_SECRET
  if (!secret || secret.length < 16) {
    throw new Error('[oauthState] NEXTAUTH_SECRET(또는 ENCRYPTION_SECRET)가 설정되지 않았거나 너무 짧습니다.')
  }
  return secret
}

function b64url(buf: Buffer): string {
  return buf.toString('base64url')
}

function sign(payload: string): string {
  return b64url(createHmac('sha256', getSecret()).update(payload).digest())
}

/** 서명된 OAuth state 발급: v1.<userId b64url>.<만료 epoch ms>.<nonce>.<hmac> */
export function signOAuthState(userId: string): string {
  const uid = b64url(Buffer.from(userId, 'utf8'))
  const exp = String(Date.now() + STATE_TTL_MS)
  const nonce = b64url(randomBytes(8))
  const payload = `${VERSION}.${uid}.${exp}.${nonce}`
  return `${payload}.${sign(payload)}`
}

/** state 검증 — 성공 시 userId 반환, 실패 시 null (서명 불일치/만료/형식 오류) */
export function verifyOAuthState(state: string | null): string | null {
  if (!state) return null
  const parts = state.split('.')
  if (parts.length !== 5 || parts[0] !== VERSION) return null
  const [, uid, exp, nonce, sig] = parts

  // 서명 검증 (timing-safe)
  const expected = sign(`${VERSION}.${uid}.${exp}.${nonce}`)
  const sigBuf = Buffer.from(sig)
  const expBuf = Buffer.from(expected)
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null

  // 만료 검증
  const expMs = Number(exp)
  if (!Number.isFinite(expMs) || Date.now() > expMs) return null

  try {
    const userId = Buffer.from(uid, 'base64url').toString('utf8')
    return userId || null
  } catch {
    return null
  }
}
