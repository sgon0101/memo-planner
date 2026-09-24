/**
 * 이미지 → 여백 크롭 → 타일 분할 — 서버 전용 (sharp)
 *
 * 순서: 원본(또는 이미지형 PDF의 페이지 JPEG) → cropMargins 범위로 좌우 크롭 →
 *       가로 > 1568이면 축소 → computeTiles 좌표대로 세로 분할 → JPEG q85
 *
 * ⚠️ 가공물(크롭·타일)은 요청 처리 중 메모리에만 존재한다. R2·DB에 저장하지 않는다.
 *
 * 성능: 긴 이미지에서 타일마다 원본을 다시 디코딩하면 O(n²)이 되므로, 크롭·축소한 결과를
 * raw로 한 번만 디코딩한 뒤 그 버퍼에서 타일을 잘라낸다 (최악 1568×48000×3 ≈ 226MB,
 * 이미지별로 순차 처리해 동시 메모리 상한을 유지).
 */

import sharp from 'sharp'
import { computeTiles } from './computeTiles'
import { SHARP_PIXEL_LIMIT, type CropResult } from './cropMargins'

export interface ImageTile {
  label: string
  /** JPEG 바이트 (base64 인코딩 전) */
  jpeg: Buffer
}

/**
 * @param labelFor 타일 라벨 생성 — (조각 번호 1-based, 조각 수) → "[이미지 2/5 · 조각 3/7]"
 */
export async function tileImage(
  buffer: Buffer,
  crop: CropResult,
  labelFor: (part: number, parts: number) => string,
): Promise<ImageTile[]> {
  const cropW = crop.x1 - crop.x0
  const plan = computeTiles(cropW, crop.height)

  // 크롭 + 축소 + 알파 제거를 한 번에 → raw RGB
  let pipeline = sharp(buffer, { limitInputPixels: SHARP_PIXEL_LIMIT })
    .rotate()
    .extract({ left: crop.x0, top: 0, width: cropW, height: crop.height })
  if (plan.scale < 1) pipeline = pipeline.resize({ width: plan.width, height: plan.height, fit: 'fill' })
  const { data, info } = await pipeline
    .flatten({ background: '#ffffff' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const tiles: ImageTile[] = []
  const parts = plan.tiles.length
  for (let i = 0; i < parts; i++) {
    const t = plan.tiles[i]
    const top = Math.min(t.top, Math.max(0, info.height - 1))
    const height = Math.min(t.height, info.height - top)
    const jpeg = await sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels as 3 } })
      .extract({ left: 0, top, width: info.width, height })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer()
    tiles.push({ label: labelFor(i + 1, parts), jpeg })
  }
  return tiles
}

/** 요청 1건의 base64 합계 한도 — 넘으면 q70으로 재인코딩 */
export const MAX_REQUEST_BASE64 = 25 * 1024 * 1024

export function base64Size(tiles: ImageTile[]): number {
  return tiles.reduce((s, t) => s + Math.ceil(t.jpeg.length / 3) * 4, 0)
}

export async function reencodeIfTooLarge(tiles: ImageTile[]): Promise<ImageTile[]> {
  if (base64Size(tiles) <= MAX_REQUEST_BASE64) return tiles
  const out: ImageTile[] = []
  for (const t of tiles) {
    out.push({ label: t.label, jpeg: await sharp(t.jpeg).jpeg({ quality: 70, mozjpeg: true }).toBuffer() })
  }
  return out
}
