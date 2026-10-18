/** 탈취된 세션으로 계정이 지워지지 않도록 계정 삭제는 최근 로그인을 요구한다 */
export const REAUTH_WINDOW_MS = 24 * 60 * 60 * 1000

/** 마지막 로그인이 없거나 24시간보다 오래됐으면 재로그인 필요 */
export function needsReauth(lastSignInAt: string | null | undefined, now = Date.now()): boolean {
  if (!lastSignInAt) return true
  const t = Date.parse(lastSignInAt)
  return Number.isNaN(t) || now - t > REAUTH_WINDOW_MS
}
