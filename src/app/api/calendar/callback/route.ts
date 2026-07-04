import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getOAuthClient } from '@/lib/google/calendar'
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

    // 서비스 롤 클라이언트 — RLS 우회, 쿠키 세션 불필요
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    const { error } = await supabase.from('user_integrations').upsert({
      user_id: userId,
      provider: 'google_calendar',
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token ?? null,
      token_expiry: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,provider' })

    if (error) {
      console.error('[calendar/callback] upsert error:', error)
      return NextResponse.redirect(`${BASE_URL}/settings?error=calendar_save_failed`)
    }

    return NextResponse.redirect(`${BASE_URL}/settings?connected=calendar`)
  } catch (err) {
    console.error('[calendar/callback] error:', err)
    return NextResponse.redirect(`${BASE_URL}/settings?error=calendar_auth_failed`)
  }
}
