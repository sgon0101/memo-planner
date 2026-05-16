import sharp from 'sharp'

export interface CompressResult {
  buffer: Buffer
  mimeType: string
  originalSize: number
  compressedSize: number
}

export async function compressImage(buffer: Buffer, mimeType: string): Promise<CompressResult> {
  const originalSize = buffer.length

  if (mimeType.startsWith('video/') || mimeType === 'image/gif') {
    return { buffer, mimeType, originalSize, compressedSize: originalSize }
  }

  const compressed = await sharp(buffer)
    .resize(1920, 1920, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 88, effort: 2 })
    .toBuffer()

  return {
    buffer: compressed,
    mimeType: 'image/webp',
    originalSize,
    compressedSize: compressed.length,
  }
}

// 960px 중간 해상도 — 에디터 중형 표시용
export async function compressMedium(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .resize(960, 960, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 85, effort: 2 })
    .toBuffer()
}

// 480px 소형 — 에디터 소형 표시 및 메모 카드 썸네일용
export async function compressThumbnail(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .resize(480, 480, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 78, effort: 2 })
    .toBuffer()
}
