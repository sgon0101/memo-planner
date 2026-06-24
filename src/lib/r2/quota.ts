/**
 * 사용자별 R2 스토리지 quota 헬퍼 (PR-3).
 *
 * - getUserStorage: 본인 uploaded_files.compressed_size 합계
 * - checkQuota: 신규 업로드 후 totalBytes가 한도 넘는지
 *
 * 기본 한도: 500MB (조정 가능 — 환경변수 STORAGE_QUOTA_BYTES)
 */

import type { SupabaseClient } from '@supabase/supabase-js'

const DEFAULT_QUOTA_BYTES = 500 * 1024 * 1024  // 500MB

export function getQuotaBytes(): number {
  const env = process.env.STORAGE_QUOTA_BYTES
  if (env) {
    const n = parseInt(env, 10)
    if (Number.isFinite(n) && n > 0) return n
  }
  return DEFAULT_QUOTA_BYTES
}

export interface StorageUsage {
  totalBytes: number
  fileCount: number
  quotaBytes: number
  percent: number
  remainingBytes: number
}

/** 사용자의 R2 사용량 조회 — service role 또는 RLS 적용된 user client 모두 가능 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getUserStorage(supabase: SupabaseClient<any>, userId: string): Promise<StorageUsage> {
  const { data } = await supabase
    .from('uploaded_files')
    .select('compressed_size')
    .eq('user_id', userId)

  const totalBytes = (data ?? []).reduce(
    (sum, r) => sum + ((r as { compressed_size?: number | null }).compressed_size ?? 0),
    0
  )
  const fileCount = (data ?? []).length
  const quotaBytes = getQuotaBytes()
  const percent = quotaBytes > 0 ? Math.round((totalBytes / quotaBytes) * 1000) / 10 : 0
  const remainingBytes = Math.max(0, quotaBytes - totalBytes)

  return { totalBytes, fileCount, quotaBytes, percent, remainingBytes }
}
