/**
 * POST /api/files/complete — presigned PUT 업로드 완료 확정
 *
 * 브라우저가 R2에 직접 올린 뒤 호출한다. 서버는 그 객체가 진짜인지 확인하고
 * (키 소유자 · 존재 · 크기 일치 · 매직바이트) 메타데이터를 기록한다.
 * 검증에 실패하면 R2 객체를 지우고 400 — 위장 파일이 버킷에 남지 않게.
 *
 * ⚠️ 원본은 절대 재인코딩하지 않는다. 이미지는 치수만 읽고 표시용 썸네일만 따로 만든다.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { r2Client, R2_BUCKET, R2_PUBLIC_URL } from '@/lib/r2/client'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import { deleteFromR2 } from '@/lib/r2/upload'
import { makeSourceThumbnail } from '@/lib/r2/compress'
import { getObjectBuffer, headObject, readObjectHead } from '@/lib/r2/presign'
import { matchesMagicBytes } from '@/lib/security/magicBytes'
import { SOURCE_IMAGE_TYPES, isSourceMime } from '@/lib/files/sourceLimits'

export const runtime = 'nodejs'
export const maxDuration = 60

const HASH_RE = /^[0-9a-f]{64}$/

export async function POST(req: NextRequest) {
  let key = ''
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })

    let body: { key?: string; fileName?: string; size?: number; contentHash?: string; mimeType?: string }
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: '잘못된 요청 형식입니다.' }, { status: 400 })
    }

    key = body.key ?? ''
    const { fileName, size, contentHash, mimeType } = body

    // 키 소유자 확인 — 남의 경로를 확정시킬 수 없게
    if (!key.startsWith(`${user.id}/files/`)) {
      return NextResponse.json({ error: '잘못된 업로드 경로입니다.' }, { status: 400 })
    }
    if (!fileName || !mimeType || !isSourceMime(mimeType)) {
      return NextResponse.json({ error: '파일 정보가 올바르지 않습니다.' }, { status: 400 })
    }
    if (!HASH_RE.test(contentHash ?? '')) {
      return NextResponse.json({ error: '파일 해시가 올바르지 않습니다.' }, { status: 400 })
    }

    // 실제 객체 확인
    const head = await headObject(key)
    if (!head) {
      return NextResponse.json({ error: '업로드된 파일을 찾을 수 없어요. 다시 시도해주세요.' }, { status: 400 })
    }
    if (typeof size === 'number' && head.size !== size) {
      await deleteFromR2(key).catch(() => {})
      return NextResponse.json({ error: '업로드가 완전하지 않아요. 다시 시도해주세요.' }, { status: 400 })
    }

    // 매직바이트 — 확장자·Content-Type 위장 차단 (앞 16바이트만 읽는다)
    const headBytes = await readObjectHead(key, 16)
    if (!headBytes || !matchesMagicBytes(headBytes, mimeType)) {
      await deleteFromR2(key).catch(() => {})
      return NextResponse.json({ error: '파일 내용이 선언된 형식과 일치하지 않습니다.' }, { status: 400 })
    }

    // 이미지: 치수 + 썸네일 (원본 무변경)
    let imageWidth: number | null = null
    let imageHeight: number | null = null
    let thumbnailUrl: string | null = null

    if (SOURCE_IMAGE_TYPES.has(mimeType)) {
      const original = await getObjectBuffer(key)
      if (original) {
        try {
          const { width, height, thumbnail } = await makeSourceThumbnail(original)
          imageWidth = width || null
          imageHeight = height || null
          const uuid = key.split('/').pop()?.replace(/\.[^.]+$/, '') ?? crypto.randomUUID()
          const thumbKey = `${user.id}/files/thumb_${uuid}.webp`
          await r2Client.send(new PutObjectCommand({
            Bucket: R2_BUCKET,
            Key: thumbKey,
            Body: thumbnail,
            ContentType: 'image/webp',
            CacheControl: 'public, max-age=31536000',
          }))
          thumbnailUrl = `${R2_PUBLIC_URL}/${thumbKey}`
        } catch (e) {
          // 썸네일 실패는 치명적이지 않다 — 원본은 이미 안전하게 올라가 있음
          console.warn('[files/complete] 썸네일 생성 실패:', e)
        }
      }
    }

    const publicUrl = `${R2_PUBLIC_URL}/${key}`
    const { data: inserted, error: insertErr } = await supabase
      .from('uploaded_files')
      .insert({
        user_id: user.id,
        r2_key: key,
        public_url: publicUrl,
        thumbnail_url: thumbnailUrl,
        content_hash: contentHash,
        file_name: fileName,
        mime_type: mimeType,
        // 소스 파일은 압축하지 않으므로 원본 = 저장 크기
        original_size: head.size,
        compressed_size: head.size,
        saved_percent: 0,
        is_source: true,
        image_width: imageWidth,
        image_height: imageHeight,
      })
      .select('id')
      .single()

    if (insertErr) {
      // UNIQUE(user_id, content_hash) 경합 — 다른 요청이 먼저 확정했다
      const { data: existing } = await supabase
        .from('uploaded_files')
        .select('id, public_url, thumbnail_url, image_width, image_height, page_count')
        .eq('user_id', user.id)
        .eq('content_hash', contentHash)
        .maybeSingle()
      if (existing) {
        await deleteFromR2(key).catch(() => {})
        return NextResponse.json({
          fileId: existing.id,
          url: existing.public_url,
          thumbnailUrl: existing.thumbnail_url ?? null,
          width: existing.image_width ?? null,
          height: existing.image_height ?? null,
          deduplicated: true,
        })
      }
      console.error('[files/complete] insert 실패:', insertErr)
      await deleteFromR2(key).catch(() => {})
      return NextResponse.json({ error: '파일 정보 저장에 실패했어요. 다시 시도해주세요.' }, { status: 500 })
    }

    return NextResponse.json({
      fileId: inserted.id,
      url: publicUrl,
      thumbnailUrl,
      width: imageWidth,
      height: imageHeight,
      deduplicated: false,
    })
  } catch (e) {
    console.error('[files/complete] 실패:', e)
    if (key) await deleteFromR2(key).catch(() => {})
    return NextResponse.json({ error: '업로드 확정에 실패했어요. 다시 시도해주세요.' }, { status: 500 })
  }
}

