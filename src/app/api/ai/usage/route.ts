/**
 * 오늘의 AI 사용량 조회
 *
 * GET /api/ai/usage
 * 반환: { buckets: { [bucket]: { used, limit } }, day: 'YYYY-MM-DD' }
 *
 * api_usage 테이블은 RLS 정책 없이 잠겨 있으므로(0016 마이그레이션 — 접근은
 * increment RPC로만) 조회는 서비스 롤 클라이언트로 수행한다. 인증은 먼저
 * 일반 클라이언트로 확인하고, 서비스 롤 조회는 본인 user_id 행으로 한정.
 */

import { NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { RATE_LIMITS, type RateBucket } from '@/lib/security/rateLimit'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const today = new Date().toISOString().slice(0, 10)

  // 기본값: 사용량 0
  const buckets = Object.fromEntries(
    (Object.keys(RATE_LIMITS) as RateBucket[]).map((b) => [b, { used: 0, limit: RATE_LIMITS[b] }])
  ) as Record<RateBucket, { used: number; limit: number }>

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (serviceKey && url) {
    try {
      const service = createServiceClient(url, serviceKey)
      const { data } = await service
        .from('api_usage')
        .select('bucket, count')
        .eq('user_id', user.id)
        .eq('day', today)
      for (const row of data ?? []) {
        const b = row.bucket as RateBucket
        if (buckets[b]) buckets[b].used = row.count
      }
    } catch (e) {
      // 조회 실패 시 0으로 표시 — 사용량 표시는 보조 정보라 fail-open
      console.warn('[ai/usage]', e instanceof Error ? e.message : e)
    }
  }

  return NextResponse.json({ buckets, day: today })
}
