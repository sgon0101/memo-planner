// Cron 엔드포인트 Bearer 토큰 검증 — timing-safe 비교
// 기존 `authHeader !== 'Bearer ${CRON_SECRET}'` 문자열 비교는 일치 길이에 따라
// 실행 시간이 달라져 타이밍 어택으로 토큰을 한 글자씩 추측할 여지가 있었다.

import { createHmac, timingSafeEqual } from 'crypto'

/** Authorization 헤더가 `Bearer <CRON_SECRET>`과 일치하는지 timing-safe로 검증 */
export function verifyCronAuth(authHeader: string | null): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret || !authHeader) return false

  // 길이가 다르면 timingSafeEqual이 throw → HMAC으로 고정 길이 다이제스트 비교
  const expected = createHmac('sha256', 'cron-auth').update(`Bearer ${secret}`).digest()
  const actual = createHmac('sha256', 'cron-auth').update(authHeader).digest()
  return timingSafeEqual(expected, actual)
}
