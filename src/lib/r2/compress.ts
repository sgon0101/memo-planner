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
    .webp({ quality: 93, effort: 2 })
    .toBuffer()

  return {
    buffer: compressed,
    mimeType: 'image/webp',
    originalSize,
    compressedSize: compressed.length,
  }
}

// 중간 해상도 — 에디터 중형 표시 + 메모 카드 썸네일용
// ⚠️ 폭 기준 960px 보장 (구버전은 960×960 fit:inside — 긴 변 기준이라
// 세로로 긴 스크린샷은 폭이 193px 수준으로 축소돼 카드에서 확대·저화질로 보였음.
// 카드/에디터는 가로 폭이 표시 화질을 결정하므로 폭을 우선 보장한다.
// 세로 상한 4800은 극단 비율(1:5 초과)의 파일 크기 폭주 방지용)
export async function compressMedium(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .resize(960, 4800, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 90, effort: 2 })
    .toBuffer()
}

// 소형 — 에디터 소형 표시용 (폭 기준 480px 보장, 세로 상한 2400 — medium과 동일 원리)
export async function compressThumbnail(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .resize(480, 2400, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 85, effort: 2 })
    .toBuffer()
}
