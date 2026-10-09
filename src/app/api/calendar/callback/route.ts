import { NextRequest, NextResponse } from 'next/server'
import { getOAuthClient } from '@/lib/google/calendar'
import { saveIntegrationTokens } from '@/lib/google/integrationTokens'
import { verifyOAuthState } from '@/lib/security/oauthState'

const BASE_URL = process.env.NEXTAUTH_URL ?? 'http://localhost:3000'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  // state 서명·만료 검증 — 실패 시 어떤 user_id도 신뢰하지 않음 (계정 탈취 차단)
  const userId = verifyOAuthState(searchParams.get('state'))

  if (!code || !userId) {
    return NextResponse.redirect(`${BASE_URL}/settings?error=calendar_auth_failed`)
  }

  try {
    const client = getOAuthClient()
    const { tokens } = await client.getToken(code)

    // 서명 검증된 state의 userId로 암호화 저장 (서비스 롤 — 쿠키 세션 불필요)
    try {
      await saveIntegrationTokens(userId, 'google_calendar', {
        accessToken: tokens.access_token ?? null,
        refreshToken: tokens.refresh_token ?? null,
        tokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
      })
    } catch (error) {
      console.error('[calendar/callback] upsert error:', error)
      return NextResponse.redirect(`${BASE_URL}/settings?error=calendar_save_failed`)
    }

    return NextResponse.redirect(`${BASE_URL}/settings?connected=calendar`)
  } catch (err) {
    console.error('[calendar/callback] error:', err)
    return NextResponse.redirect(`${BASE_URL}/settings?error=calendar_auth_failed`)
  }
}
