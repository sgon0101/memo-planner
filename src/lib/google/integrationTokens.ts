import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { decryptToken, encryptToken } from '@/lib/crypto/tokenCipher'

/**
 * user_integrations 토큰 접근 단일 출처 — 읽기·쓰기 모두 여기를 거친다.
 *
 * - 서비스 롤로 접근하고 저장 시 암호화, 읽을 때 복호화한다 (브라우저는 토큰 컬럼을 보지 않는다).
 * - 서비스 롤은 RLS를 우회하므로 userId는 호출하는 쪽이 검증한 값이어야 한다:
 *   사용자 라우트는 `supabase.auth.getUser()`의 user.id, cron은 `verifyCronAuth` 통과 후,
 *   OAuth callback은 서명 검증된 state(`verifyOAuthState`)의 user_id.
 */

export type IntegrationProvider = 'google_drive' | 'google_calendar'

export interface IntegrationTokens {
  accessToken: string | null
  refreshToken: string | null
  tokenExpiry: string | null
  metadata: Record<string, unknown>
}

/** 연동 행이 없으면 null. 조회·복호화 실패는 throw. */
export async function getIntegrationTokens(
  userId: string,
  provider: IntegrationProvider,
): Promise<IntegrationTokens | null> {
  const { data, error } = await createAdminClient()
    .from('user_integrations')
    .select('access_token, refresh_token, token_expiry, metadata')
    .eq('user_id', userId)
    .eq('provider', provider)
    .maybeSingle()
  if (error) throw new Error(`[integrationTokens] 조회 실패: ${error.message}`)
  if (!data) return null
  return {
    accessToken: data.access_token ? decryptToken(data.access_token) : null,
    refreshToken: data.refresh_token ? decryptToken(data.refresh_token) : null,
    tokenExpiry: data.token_expiry ?? null,
    metadata: (data.metadata as Record<string, unknown> | null) ?? {},
  }
}

/**
 * 토큰 저장 (행이 없으면 생성). undefined인 필드는 건드리지 않고, null은 비운다.
 * metadata는 건드리지 않는다.
 */
export async function saveIntegrationTokens(
  userId: string,
  provider: IntegrationProvider,
  tokens: { accessToken?: string | null; refreshToken?: string | null; tokenExpiry?: string | null },
): Promise<void> {
  const row: Record<string, unknown> = {
    user_id: userId,
    provider,
    updated_at: new Date().toISOString(),
  }
  if (tokens.accessToken !== undefined) row.access_token = tokens.accessToken ? encryptToken(tokens.accessToken) : null
  if (tokens.refreshToken !== undefined) row.refresh_token = tokens.refreshToken ? encryptToken(tokens.refreshToken) : null
  if (tokens.tokenExpiry !== undefined) row.token_expiry = tokens.tokenExpiry

  const { error } = await createAdminClient()
    .from('user_integrations')
    .upsert(row, { onConflict: 'user_id,provider' })
  if (error) throw new Error(`[integrationTokens] 저장 실패: ${error.message}`)
}
