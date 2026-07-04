/**
 * 파일 업로드 라우트 (PR-3 강화).
 *
 * 개선:
 *   - SHA-256 content_hash로 멱등 — 같은 사용자 같은 파일 중복 업로드 차단
 *   - 사용자별 quota gate (기본 500MB)
 *   - uploaded_files insert를 await — fire-and-forget 제거
 *   - thumbnail_url / medium_url 함께 저장 (GC 시 변형까지 추적)
 */

import { NextRequest, NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { createClient } from '@/lib/supabase/server'
import { uploadToR2 } from '@/lib/r2/upload'
import { getUserStorage } from '@/lib/r2/quota'
import { matchesMagicBytes } from '@/lib/security/magicBytes'

export const runtime = 'nodejs'

const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const MAX_VIDEO_BYTES = 200 * 1024 * 1024
const MAX_PDF_BYTES = 50 * 1024 * 1024

const ALLOWED_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml',
  'video/mp4', 'video/webm', 'video/ogg',
  'application/pdf',
])

function getMaxBytes(mimeType: string): number {
  if (mimeType.startsWith('video/')) return MAX_VIDEO_BYTES
  if (mimeType === 'application/pdf') return MAX_PDF_BYTES
  return MAX_IMAGE_BYTES
}

function getFolder(mimeType: string): 'images' | 'videos' | 'files' {
  if (mimeType.startsWith('video/')) return 'videos'
  if (mimeType === 'application/pdf') return 'files'
  return 'images'
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: '잘못된 요청 형식입니다.' }, { status: 400 })
  }

  const fileEntry = formData.get('file')
  if (!(fileEntry instanceof File)) {
    return NextResponse.json({ error: '파일이 없습니다.' }, { status: 400 })
  }

  const mimeType = fileEntry.type || 'application/octet-stream'
  if (!ALLOWED_TYPES.has(mimeType)) {
    return NextResponse.json({ error: '허용되지 않는 파일 형식입니다.' }, { status: 400 })
  }

  const arrayBuffer = await fileEntry.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  if (buffer.length > getMaxBytes(mimeType)) {
    return NextResponse.json({ error: '파일 크기 제한을 초과했습니다.' }, { status: 413 })
  }

  // magic bytes 검증 — Content-Type 위조(예: exe를 image/jpeg로) 차단
  if (!matchesMagicBytes(buffer, mimeType)) {
    return NextResponse.json({ error: '파일 내용이 선언된 형식과 일치하지 않습니다.' }, { status: 400 })
  }

  // ─── PR-3: SHA-256 멱등 — 같은 파일 이미 업로드한 적 있으면 기존 URL 반환 ───
  const contentHash = crypto.createHash('sha256').update(buffer).digest('hex')

  const { data: existing } = await supabase
    .from('uploaded_files')
    .select('r2_key, public_url, thumbnail_url, medium_url, original_size, compressed_size, saved_percent, mime_type')
    .eq('user_id', user.id)
    .eq('content_hash', contentHash)
    .maybeSingle()

  if (existing) {
    return NextResponse.json({
      url: existing.public_url,
      thumbnailUrl: existing.thumbnail_url ?? null,
      mediumUrl: existing.medium_url ?? null,
      key: existing.r2_key,
      originalSize: existing.original_size ?? 0,
      compressedSize: existing.compressed_size ?? 0,
      savedPercent: existing.saved_percent ?? 0,
      deduplicated: true,
    })
  }

  // ─── PR-3: quota gate — 신규 업로드 후 합계가 한도 넘으면 차단 ───
  const usage = await getUserStorage(supabase, user.id)
  if (usage.totalBytes + buffer.length > usage.quotaBytes) {
    return NextResponse.json({
      error: `스토리지 한도 초과 (${Math.round(usage.totalBytes / 1024 / 1024)}MB / ${Math.round(usage.quotaBytes / 1024 / 1024)}MB 사용 중). 불필요한 파일을 정리하거나 한도 상향이 필요합니다.`,
      quotaBytes: usage.quotaBytes,
      totalBytes: usage.totalBytes,
    }, { status: 413 })
  }

  const folder = getFolder(mimeType)
  const result = await uploadToR2(buffer, mimeType, user.id, folder)

  // ─── PR-3: 메타데이터 insert를 await + 실패 시 R2 객체 롤백 시도 ───
  const { error: insertErr } = await supabase.from('uploaded_files').insert({
    user_id: user.id,
    r2_key: result.key,
    public_url: result.url,
    thumbnail_url: result.thumbnailUrl,
    medium_url: result.mediumUrl,
    content_hash: contentHash,
    file_name: fileEntry.name,
    mime_type: result.mimeType,
    original_size: result.originalSize,
    compressed_size: result.compressedSize,
    saved_percent: result.savedPercent,
  })

  if (insertErr) {
    console.error('[upload] uploaded_files insert 실패:', insertErr)
    // R2엔 객체가 올라갔는데 DB 추적이 안 됨 → orphan 방지 위해 즉시 R2 정리 시도
    // (best-effort — 실패하면 다음 GC가 정리)
    try {
      const { deleteFromR2 } = await import('@/lib/r2/upload')
      await deleteFromR2(result.key)
    } catch {}
    return NextResponse.json({ error: '메타데이터 저장 실패 — 다시 시도해주세요.' }, { status: 500 })
  }

  return NextResponse.json({
    url: result.url,
    thumbnailUrl: result.thumbnailUrl,
    mediumUrl: result.mediumUrl,
    key: result.key,
    originalSize: result.originalSize,
    compressedSize: result.compressedSize,
    savedPercent: result.savedPercent,
  })
}
