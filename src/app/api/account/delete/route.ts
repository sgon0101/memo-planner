/**
 * 계정 삭제 (2026-10-18).
 *
 * 순서가 핵심 — 각 단계는 다시 실행해도 안전하다(멱등):
 *   1. Google 토큰 철회 (best effort — 실패해도 계속)
 *   2. R2 `${userId}/` 전체 삭제 — 실패하면 중단(500). DB가 남아 있어야 재시도할 수 있다.
 *      DB를 먼저 지우고 R2가 실패하면 주인 없는 공개 파일이 영원히 남는다
 *      (r2-gc는 uploaded_files 기준이라 행이 사라진 객체는 다시 찾지 못한다).
 *   3. auth.admin.deleteUser — public 테이블은 전부 auth.users CASCADE로 지워진다
 *      (api_usage는 0021에서 FK 추가). 테이블별 수동 삭제를 하지 않는다.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getIntegrationTokens, type IntegrationProvider } from '@/lib/google/integrationTokens'
import { deleteUserObjects } from '@/lib/r2/deletePrefix'
import { needsReauth } from '@/lib/account/reauth'

export const runtime = 'nodejs'
export const maxDuration = 60

const CONFIRM_TEXT = '계정 삭제'
const PROVIDERS: IntegrationProvider[] = ['google_drive', 'google_calendar']

export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '로그인이 필요해요.' }, { status: 401 })

  let body: unknown = null
  try { body = await req.json() } catch { /* 아래에서 400 */ }
  if ((body as { confirm?: unknown } | null)?.confirm !== CONFIRM_TEXT) {
    return NextResponse.json({ error: '확인 문구가 일치하지 않아요.' }, { status: 400 })
  }

  if (needsReauth(user.last_sign_in_at)) {
    return NextResponse.json(
      { error: '보안을 위해 다시 로그인한 뒤 삭제해주세요.', code: 'REAUTH_REQUIRED' },
      { status: 403 },
    )
  }

  const userId = user.id

  // 1. Google 앱 권한 철회
  for (const provider of PROVIDERS) await revokeGoogle(userId, provider)

  // 2. R2
  let r2Deleted: number
  try {
    r2Deleted = await deleteUserObjects(userId)
  } catch (err) {
    console.error('[account/delete] R2 삭제 실패', { userId, err: err instanceof Error ? err.message : String(err) })
    return NextResponse.json({ error: '파일을 삭제하지 못했어요. 잠시 후 다시 시도해주세요.' }, { status: 500 })
  }

  // 3. 계정 (CASCADE로 DB 전체)
  const { error } = await createAdminClient().auth.admin.deleteUser(userId)
  if (error && !isUserNotFound(error)) {
    console.error('[account/delete] 계정 삭제 실패', { userId, r2Deleted, err: error.message })
    return NextResponse.json({ error: '계정을 삭제하지 못했어요. 잠시 후 다시 시도해주세요.' }, { status: 500 })
  }

  console.error('[account/delete] 완료', { userId, r2Deleted })
  return NextResponse.json({ ok: true, r2Deleted })
}

function isUserNotFound(error: { status?: number; code?: string; message: string }): boolean {
  return error.status === 404 || error.code === 'user_not_found' || /not\s*found/i.test(error.message)
}

/** best effort — 토큰 값은 로그에 남기지 않는다 */
async function revokeGoogle(userId: string, provider: IntegrationProvider): Promise<void> {
  try {
    const tokens = await getIntegrationTokens(userId, provider)
    const token = tokens?.refreshToken ?? tokens?.accessToken
    if (!token) return
    const res = await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString(),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) console.error('[account/delete] Google 토큰 철회 실패', { userId, provider, status: res.status })
  } catch (err) {
    console.error('[account/delete] Google 토큰 철회 오류', { userId, provider, err: err instanceof Error ? err.message : String(err) })
  }
}
