import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { r2Client, R2_BUCKET, R2_PUBLIC_URL } from './client'
import { compressImage } from './compress'

export interface UploadResult {
  url: string
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
  const key = `${userId}/${folder}/${crypto.randomUUID()}.${ext}`

  await r2Client.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: finalMimeType,
    CacheControl: 'public, max-age=31536000',
  }))

  const url = `${R2_PUBLIC_URL}/${key}`
  const savedPercent = originalSize > 0 ? Math.round((1 - compressedSize / originalSize) * 100) : 0

  return { url, key, originalSize, compressedSize, savedPercent, mimeType: finalMimeType }
}

export async function deleteFromR2(key: string): Promise<void> {
  await r2Client.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }))
}
