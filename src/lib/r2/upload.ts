import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { r2Client, R2_BUCKET, R2_PUBLIC_URL } from './client'
import { compressImage, compressMedium, compressThumbnail } from './compress'

export interface UploadResult {
  url: string
  thumbnailUrl: string | null
  mediumUrl: string | null
  key: string
  originalSize: number
  compressedSize: number
  savedPercent: number
  mimeType: string
}

export async function uploadToR2(
  file: Buffer,
  mimeType: string,
  userId: string,
  folder: 'images' | 'videos' | 'files' = 'images'
): Promise<UploadResult> {
  const isImage = mimeType.startsWith('image/') && mimeType !== 'image/gif'

  // 원본에서 모든 변형 병렬 생성 (재인코딩 손실 방지)
  const [fullResult, medBuffer, thumbBuffer] = await Promise.all([
    compressImage(file, mimeType),
    isImage ? compressMedium(file) : Promise.resolve(null),
    isImage ? compressThumbnail(file) : Promise.resolve(null),
  ])

  const { buffer, mimeType: finalMimeType, originalSize, compressedSize } = fullResult
  const ext = finalMimeType === 'image/webp' ? 'webp' : (mimeType.split('/')[1] || 'bin')
  const uuid = crypto.randomUUID()
  const key = `${userId}/${folder}/${uuid}.${ext}`
  const thumbnailKey = isImage ? `${userId}/${folder}/thumb_${uuid}.webp` : null
  const mediumKey = isImage ? `${userId}/${folder}/md_${uuid}.webp` : null

  const uploads: Promise<void>[] = [
    r2Client.send(new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: finalMimeType,
      CacheControl: 'public, max-age=31536000',
    })).then(() => undefined),
  ]

  if (isImage && thumbBuffer && thumbnailKey) {
    uploads.push(
      r2Client.send(new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: thumbnailKey,
        Body: thumbBuffer,
        ContentType: 'image/webp',
        CacheControl: 'public, max-age=31536000',
      })).then(() => undefined)
    )
  }

  if (isImage && medBuffer && mediumKey) {
    uploads.push(
      r2Client.send(new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: mediumKey,
        Body: medBuffer,
        ContentType: 'image/webp',
        CacheControl: 'public, max-age=31536000',
      })).then(() => undefined)
    )
  }

  await Promise.all(uploads)

  const url = `${R2_PUBLIC_URL}/${key}`
  const thumbnailUrl = thumbnailKey ? `${R2_PUBLIC_URL}/${thumbnailKey}` : null
  const mediumUrl = mediumKey ? `${R2_PUBLIC_URL}/${mediumKey}` : null
  const savedPercent = originalSize > 0 ? Math.round((1 - compressedSize / originalSize) * 100) : 0

  return { url, thumbnailUrl, mediumUrl, key, originalSize, compressedSize, savedPercent, mimeType: finalMimeType }
}

export async function deleteFromR2(key: string): Promise<void> {
  await r2Client.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }))
}
