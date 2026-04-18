import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getDriveAuthUrl } from '@/lib/google/drive'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = getDriveAuthUrl(user.id)
  return NextResponse.redirect(url)
}
