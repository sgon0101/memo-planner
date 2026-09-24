/**
 * R2 presigned URL 헬퍼 (소스 파일 전용)
 *
 * 왜 presign인가: Vercel 함수는 요청/응답 본문이 4.5MB로 제한된다. PDF 50MB·
 * 이미지 30MB를 서버로 통과시킬 수 없으므로 **바이트는 브라우저 ↔ R2 직접**으로
 * 오가고, 서버는 권한 확인·메타데이터·썸네일만 담당한다.
 */

import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { r2Client, R2_BUCKET } from './client'

export const PUT_EXPIRES_SEC = 600   // 10분 — 대용량 업로드 여유
export const GET_EXPIRES_SEC = 60    // 다운로드 리다이렉트 직후 사용

/**
 * 업로드용 presigned PUT URL.
 *
 * ⚠️ ContentType만 서명한다. CacheControl까지 서명하면 브라우저가 `cache-control`
 * 요청 헤더를 보내야 하는데, 버킷 CORS의 AllowedHeaders가 `content-type`뿐이라
 * preflight에서 막힌다. 소스 파일 원본은 항상 `/api/files/[id]/download`(presigned GET)로
 * 내려가므로 객체 자체의 Cache-Control은 필요하지 않다.
 * (서버가 직접 올리는 썸네일에는 기존대로 max-age를 건다)
 */
export function presignPut(key: string, contentType: string): Promise<string> {
  return getSignedUrl(
    r2Client,
    new PutObjectCommand({ Bucket: R2_BUCKET, Key: key, ContentType: contentType }),
    { expiresIn: PUT_EXPIRES_SEC },
  )
}

/** 비ASCII 문자를 `_`로 바꾼 폴백 파일명 (확장자는 보존) */
export function asciiFallbackName(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  const base = dot > 0 ? fileName.slice(0, dot) : fileName
  const ext = dot > 0 ? fileName.slice(dot) : ''
  const safeBase = base.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_').trim() || 'file'
  const safeExt = ext.replace(/[^\x20-\x7E]/g, '') || ''
  return `${safeBase}${safeExt}`
}

/**
 * 다운로드/열기용 presigned GET URL.
 * 한글 파일명 보존: RFC 5987 `filename*=UTF-8''...` + ASCII 폴백 병기.
 */
export function presignGet(
  key: string,
  opts: { mimeType: string; fileName: string; mode: 'inline' | 'attachment' },
): Promise<string> {
  const fallback = asciiFallbackName(opts.fileName)
  const encoded = encodeURIComponent(opts.fileName)
  const disposition = `${opts.mode}; filename="${fallback}"; filename*=UTF-8''${encoded}`

  return getSignedUrl(
    r2Client,
    new GetObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      ResponseContentType: opts.mimeType,
      ResponseContentDisposition: disposition,
    }),
    { expiresIn: GET_EXPIRES_SEC },
  )
}

/** 업로드 완료 확인 — 객체 존재 여부와 크기 */
export async function headObject(key: string): Promise<{ size: number } | null> {
  try {
    const res = await r2Client.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }))
    return { size: res.ContentLength ?? 0 }
  } catch {
    return null
  }
}

/** 객체 앞부분만 읽기 — 매직바이트 검증용 (전체를 받지 않는다) */
export async function readObjectHead(key: string, bytes = 16): Promise<Buffer | null> {
  try {
    const res = await r2Client.send(new GetObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Range: `bytes=0-${bytes - 1}`,
    }))
    if (!res.Body) return null
    const arr = await res.Body.transformToByteArray()
    return Buffer.from(arr)
  } catch {
    return null
  }
}

/** 객체 전체 다운로드 (서버 outbound라 4.5MB 제한과 무관) — 썸네일·분석용 */
export async function getObjectBuffer(key: string): Promise<Buffer | null> {
  try {
    const res = await r2Client.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }))
    if (!res.Body) return null
    const arr = await res.Body.transformToByteArray()
    return Buffer.from(arr)
  } catch {
    return null
  }
}
