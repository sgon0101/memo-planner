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

  // ⚠️ 폭 기준 1920px 보장 (구버전은 1920×1920 fit:inside — 긴 변 기준이라
  // 세로로 긴 스크린샷은 full-res 원본조차 폭 387px 수준으로 축소돼, md/thumb를
  // 재생성해도 폭이 이 이하로 상한돼 저화질이 고착됐음. full은 폭이 화질을 결정하므로
  // 폭을 우선 보장. 세로 상한 9600은 극단 비율(1:5 초과) 파일 크기 폭주 방지용.
  const compressed = await sharp(buffer)
    .resize(1920, 9600, { fit: 'inside', withoutEnlargement: true })
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

// ─────────────────────────────────────────────────────────────────────────
// 소스 파일(원본 무손실 보존) 전용 — 표시용 썸네일만 따로 만든다.
// 기존 compressThumbnail과 분리한 이유:
//   ① limitInputPixels — 1440×40000 같은 초장축 캡처가 sharp 기본 한도에 걸리지 않게
//   ② 세로로 긴 이미지는 축소가 아니라 **상단 크롭** — 1080×20000을 480폭에 맞춰
//      축소하면 높이 8888px짜리 실 같은 썸네일이 되어 스트립에서 아무것도 안 보인다
// ─────────────────────────────────────────────────────────────────────────

/** sharp 입력 픽셀 상한 — 2160×70000 수준까지 허용 */
export const SOURCE_PIXEL_LIMIT = 150_000_000

const SOURCE_THUMB_W = 480
const SOURCE_THUMB_MAX_H = 640

export interface SourceImageMeta {
  width: number
  height: number
  thumbnail: Buffer
}

/** 소스 이미지 원본에서 치수 + 상단 크롭 썸네일 생성 (원본은 재인코딩하지 않는다) */
export async function makeSourceThumbnail(buffer: Buffer): Promise<SourceImageMeta> {
  const base = sharp(buffer, { limitInputPixels: SOURCE_PIXEL_LIMIT })
  const meta = await base.metadata()
  const width = meta.width ?? 0
  const height = meta.height ?? 0

  // 폭 기준 축소 후, 너무 길면 위쪽만 잘라 카드에 보이게
  const pipeline = sharp(buffer, { limitInputPixels: SOURCE_PIXEL_LIMIT })
    .resize({ width: SOURCE_THUMB_W, withoutEnlargement: true })

  const scaledH = width > 0 ? Math.round(height * Math.min(1, SOURCE_THUMB_W / width)) : 0
  const thumbnail = scaledH > SOURCE_THUMB_MAX_H
    ? await pipeline
        .extract({ left: 0, top: 0, width: Math.min(SOURCE_THUMB_W, width), height: SOURCE_THUMB_MAX_H })
        .webp({ quality: 85, effort: 2 })
        .toBuffer()
    : await pipeline.webp({ quality: 85, effort: 2 }).toBuffer()

  return { width, height, thumbnail }
}
