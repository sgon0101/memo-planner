/**
 * 사용자별 R2 스토리지 사용량 (PR-3).
 *
 * GET /api/storage/status
 *
 * 응답:
 *   {
 *     totalBytes: 123_456_789,
 *     fileCount: 137,
 *     quotaBytes: 524_288_000,
 *     percent: 23.5,
 *     remainingBytes: 400_831_211,
 *   }
 */

import { createClient } from '@/lib/supabase/server'
import { getUserStorage } from '@/lib/r2/quota'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return Response.json({ error: 'unauthorized' }, { status: 401 })

    const usage = await getUserStorage(supabase, user.id)
    return Response.json(usage)
  } catch (err) {
    console.error('[storage/status]', err)
    return Response.json({ error: '스토리지 조회 실패' }, { status: 500 })
  }
}
