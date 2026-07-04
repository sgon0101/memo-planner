// 사용자별 일일 API 호출 한도 — supabase/migrations/0016_api_rate_limit.sql의
// increment_api_usage RPC를 사용한다 (원자적 upsert + 한도 검사).
//
// fail-open 정책: RPC가 아직 배포되지 않았거나 오류가 나면 요청을 허용하고
// 콘솔에만 기록한다 — 마이그레이션 누락이 서비스 전체 장애로 번지지 않도록.

import type { SupabaseClient } from '@supabase/supabase-js'

/** 엔드포인트별 일일 한도 (사용자당) */
export const RATE_LIMITS = {
  'ai-chat': 300,            // 대화 — 가볍지만 빈번
  'ai-insights': 40,         // 갭 분석/관심사 — max_tokens 큼
  'ai-report': 40,           // 회고 리포트
  'ai-analyze-profile': 30,  // 프로필 전체 분석 — 가장 무거움
  'ai-profile-insight': 60,  // 프로필 제안 카드
} as const

export type RateBucket = keyof typeof RATE_LIMITS

interface RateResult {
  ok: boolean
  /** 한도 초과 시 사용자에게 보여줄 메시지 */
  message?: string
}

export async function checkRateLimit(
  supabase: SupabaseClient,
  bucket: RateBucket,
): Promise<RateResult> {
  const limit = RATE_LIMITS[bucket]
  try {
    const { data, error } = await supabase.rpc('increment_api_usage', {
      p_bucket: bucket,
      p_limit: limit,
    })
    if (error) {
      // RPC 미배포/일시 오류 — fail-open
      console.error(`[rateLimit] rpc error (fail-open, bucket=${bucket}):`, error.message)
      return { ok: true }
    }
    if (data === -1) {
      return {
        ok: false,
        message: `오늘 사용 한도(${limit}회)에 도달했어요. 내일 다시 시도해주세요.`,
      }
    }
    return { ok: true }
  } catch (e) {
    console.error(`[rateLimit] unexpected error (fail-open, bucket=${bucket}):`, e)
    return { ok: true }
  }
}

/** 429 응답 헬퍼 */
export function rateLimitResponse(message?: string): Response {
  return Response.json(
    { error: message ?? '요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요.' },
    { status: 429 },
  )
}
