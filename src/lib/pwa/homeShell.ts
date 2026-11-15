/**
 * 홈 화면 앱 셸 캐시 (2026-11-15).
 *
 * sw.js가 `/home` HTML을 이 캐시에 저장해 두고, 앱을 열 때 서버(콜드 스타트·토큰 갱신)를 기다리지 않고
 * 바로 띄운다(stale-while-revalidate). 이 모듈은 브라우저 쪽 헬퍼 — 캐시 이름은 sw.js의 SHELL_CACHE와 같아야 한다.
 *
 * - 저장된 셸에는 사이드바의 이름·이메일이 들어 있으므로 로그아웃·로그인 화면 진입 시 지운다.
 * - 셸 HTML의 <meta name="weave-build">로 '더 새 버전을 받아 뒀는지'를 판단한다.
 */

export const SHELL_CACHE = 'weave-shell-v1'

/** 지금 실행 중인 코드의 빌드 시각(ms). next.config가 빌드 때 주입, dev는 0 */
export const BUILD_TIME = Number(process.env.NEXT_PUBLIC_BUILD_TIME || 0)

export async function clearHomeShell(): Promise<void> {
  try {
    if (typeof caches !== 'undefined') await caches.delete(SHELL_CACHE)
  } catch {
    /* 캐시 접근 불가(사파리 사생활 보호 모드 등) — 무시 */
  }
}

/** 저장된 셸의 빌드 시각. 셸이 없거나 읽을 수 없으면 null */
export async function readShellBuildTime(): Promise<number | null> {
  try {
    if (typeof caches === 'undefined') return null
    const cache = await caches.open(SHELL_CACHE)
    const res = await cache.match('/home')
    if (!res) return null
    const html = await res.text()
    const m = html.match(/<meta name="weave-build" content="(\d+)"/)
    return m ? Number(m[1]) : null
  } catch {
    return null
  }
}
