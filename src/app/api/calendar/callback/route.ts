import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getOAuthClient } from '@/lib/google/calendar'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const userId = searchParams.get('state')

  if (!code || !userId) {
    return NextResponse.redirect(`${process.env.NEXTAUTH_URL}/settings?error=calendar_auth_failed`)
  }

  const client = getOAuthClient()
  const { tokens } = await client.getToken(code)

  const supabase = await createClient()
  await supabase.from('user_integrations').upsert({
    user_id: userId,
    provider: 'google_calendar',
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    token_expiry: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
  }, { onConflict: 'user_id,provider' })

  return NextResponse.redirect(`${process.env.NEXTAUTH_URL}/settings?success=calendar_connected`)
}
