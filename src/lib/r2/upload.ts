import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { r2Client, R2_BUCKET, R2_PUBLIC_URL } from './client'
import { compressImage, compressThumbnail } from './compress'

export interface UploadResult {
  url: string
  thumbnailUrl: string | null
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
  const { buffer, mimeType: finalMimeType, originalSize, compressedSize } =
    await compressImage(file, mimeType)

  const ext = finalMimeType === 'image/webp' ? 'webp' : (mimeType.split('/')[1] || 'bin')
  const uuid = crypto.randomUUID()
  const key = `${userId}/${folder}/${uuid}.${ext}`

  const isImage = finalMimeType.startsWith('image/')

  // 원본 + 썸네일 병렬 업로드
  const uploads: Promise<void>[] = [
    r2Client.send(new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: finalMimeType,
      CacheControl: 'public, max-age=31536000',
    })).then(() => undefined),
  ]

  let thumbnailKey: string | null = null
  if (isImage) {
    thumbnailKey = `${userId}/${folder}/thumb_${uuid}.webp`
    uploads.push(
      compressThumbnail(buffer).then((thumbBuffer) =>
        r2Client.send(new PutObjectCommand({
          Bucket: R2_BUCKET,
          Key: thumbnailKey!,
          Body: thumbBuffer,
          ContentType: 'image/webp',
          CacheControl: 'public, max-age=31536000',
        })).then(() => undefined)
      )
    )
  }

  await Promise.all(uploads)

  const url = `${R2_PUBLIC_URL}/${key}`
  const thumbnailUrl = thumbnailKey ? `${R2_PUBLIC_URL}/${thumbnailKey}` : null
  const savedPercent = originalSize > 0 ? Math.round((1 - compressedSize / originalSize) * 100) : 0

  return { url, thumbnailUrl, key, originalSize, compressedSize, savedPercent, mimeType: finalMimeType }
}

export async function deleteFromR2(key: string): Promise<void> {
  await r2Client.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }))
}
