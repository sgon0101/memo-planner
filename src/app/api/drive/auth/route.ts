import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getDriveAuthUrl } from '@/lib/google/drive'
import { signOAuthState } from '@/lib/security/oauthState'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 평문 user_id 대신 HMAC 서명된 state — callback에서 검증
  const url = getDriveAuthUrl(signOAuthState(user.id))
  return NextResponse.redirect(url)
}
