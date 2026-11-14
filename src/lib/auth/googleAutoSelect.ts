/**
 * Google 원탭 자동 로그인(auto_select) 제어 — 로그아웃 루프 방지
 *
 * 원탭은 이전에 로그인한 계정이 하나면 로그인 화면에서 바로 자동 로그인한다.
 * 그대로 두면 사용자가 로그아웃해 로그인 화면으로 오자마자 다시 로그인돼 "로그아웃이 안 된다"처럼 보인다
 * (Chrome은 자동 로그인 후 10분만 다시 자동 로그인을 막는다 — 2026-11-14 미리보기에서 확인).
 * Google 권장대로 로그아웃 시 자동 선택을 끄고, 다음에 Google로 직접 로그인하면 다시 켠다.
 */
const KEY = 'weave:google-signed-out'

/** 로그아웃 직전에 호출 — 다음 로그인 화면에서 자동 로그인하지 않는다 */
export function markGoogleSignedOut(): void {
  try { localStorage.setItem(KEY, '1') } catch { /* 저장 불가 환경 — 무시 */ }
  // 로그인 화면이 아닌 곳에서도 GIS가 떠 있다면 바로 끈다
  try { window.google?.accounts?.id?.disableAutoSelect() } catch { /* ignore */ }
}

/** 로그인 화면: 직접 로그아웃한 뒤인지 */
export function wasGoogleSignedOut(): boolean {
  try { return localStorage.getItem(KEY) === '1' } catch { return false }
}

/** Google로 직접 로그인 성공 후 — 다음부터 다시 자동 로그인 허용 */
export function clearGoogleSignedOut(): void {
  try { localStorage.removeItem(KEY) } catch { /* ignore */ }
}
