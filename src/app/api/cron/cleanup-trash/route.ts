import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { verifyCronAuth } from '@/lib/security/cronAuth'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  if (!verifyCronAuth(request.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - 30)

  const { error, count } = await supabase
    .from('memos')
    .delete({ count: 'exact' })
    .eq('is_deleted', true)
    .lt('deleted_at', cutoff.toISOString())

  if (error) {
    console.error('cleanup-trash error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ deleted: count ?? 0 })
}
