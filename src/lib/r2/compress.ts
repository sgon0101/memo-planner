import sharp from 'sharp'

export interface CompressResult {
  buffer: Buffer
  mimeType: string
  originalSize: number
  compressedSize: number
}

export async function compressImage(buffer: Buffer, mimeType: string): Promise<CompressResult> {
  const originalSize = buffer.length

  if (mimeType.startsWith('video/')) {
    return { buffer, mimeType, originalSize, compressedSize: originalSize }
  }

  if (mimeType === 'image/gif') {
    return { buffer, mimeType, originalSize, compressedSize: originalSize }
  }

  const compressed = await sharp(buffer)
    .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82, effort: 2 })
    .toBuffer()

  return {
    buffer: compressed,
    mimeType: 'image/webp',
    originalSize,
    compressedSize: compressed.length,
  }
}

export async function compressThumbnail(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .resize(400, 225, { fit: 'cover', position: 'centre' })
    .webp({ quality: 70, effort: 2 })
    .toBuffer()
}
