/**
 * 좌우 여백 자동 크롭 — 서버 전용 (sharp)
 *
 * 데스크톱 웹 캡처는 좌우 회색·흰 여백이 폭의 50~65%를 차지한다. 그대로 1568px로
 * 축소하면 본문 칼럼이 수백 px로 줄어 작은 글씨가 흐려지므로 본문 칼럼만 남긴다.
 *
 * ⚠️ 분석 순간 메모리에서만 쓰는 좌표 계산이다 — 원본·크롭 결과는 저장하지 않는다.
 * 세로(상하) 크롭은 하지 않는다 (타일 순서·위치 라벨이 어긋남).
 */

import sharp from 'sharp'

export const SHARP_PIXEL_LIMIT = 150_000_000

const ROW_STEP = 4          // 행 샘플링 간격(px)
const EDGE = 16             // 행 배경색 추정에 쓰는 양 끝 폭
const DIFF = 20             // 배경과 이만큼 다르면 콘텐츠 픽셀
const COL_RATIO = 0.015     // 콘텐츠 행 비율이 이 이상인 열 = 콘텐츠 열
const PADDING = 24
const MAX_KEEP_RATIO = 0.85 // 크롭 폭이 원본의 85% 초과면 크롭 의미 없음
const MIN_WIDTH = 320

export interface CropResult {
  x0: number
  x1: number
  width: number   // 원본 가로
  height: number  // 원본 세로
  cropped: boolean
}

function median(values: number[]): number {
  const s = values.slice().sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

/** 이미 greyscale raw로 디코딩된 버퍼에서 콘텐츠 열 범위를 찾는다 (순수 계산) */
export function detectContentColumns(grey: Uint8Array, width: number, height: number): CropResult {
  const full: CropResult = { x0: 0, x1: width, width, height, cropped: false }
  if (width < MIN_WIDTH + 2 * EDGE || height < 1) return full

  const hits = new Uint32Array(width)
  let sampled = 0
  const edgeVals: number[] = new Array(EDGE * 2)

  for (let y = 0; y < height; y += ROW_STEP) {
    const row = y * width
    for (let i = 0; i < EDGE; i++) {
      edgeVals[i] = grey[row + i]
      edgeVals[EDGE + i] = grey[row + width - 1 - i]
    }
    const bg = median(edgeVals)
    for (let x = 0; x < width; x++) {
      if (Math.abs(grey[row + x] - bg) > DIFF) hits[x]++
    }
    sampled++
  }
  if (sampled === 0) return full

  const threshold = sampled * COL_RATIO
  let left = -1
  let right = -1
  for (let x = 0; x < width; x++) {
    if (hits[x] > threshold) { left = x; break }
  }
  for (let x = width - 1; x >= 0; x--) {
    if (hits[x] > threshold) { right = x; break }
  }
  if (left < 0 || right < left) return full

  const x0 = Math.max(0, left - PADDING)
  const x1 = Math.min(width, right + 1 + PADDING)
  const w = x1 - x0
  if (w <= width * MAX_KEEP_RATIO && w >= MIN_WIDTH) {
    return { x0, x1, width, height, cropped: true }
  }
  return full
}

/** 이미지 버퍼 → 크롭 범위 (분석용, 저장 안 함) */
export async function detectCrop(buffer: Buffer): Promise<CropResult> {
  const { data, info } = await sharp(buffer, { limitInputPixels: SHARP_PIXEL_LIMIT })
    .rotate()
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true })
  // greyscale raw는 채널 1개 (알파가 있으면 2개일 수 있어 첫 채널만 사용)
  const channels = info.channels
  let grey: Uint8Array = data
  if (channels !== 1) {
    grey = new Uint8Array(info.width * info.height)
    for (let i = 0, j = 0; i < grey.length; i++, j += channels) grey[i] = data[j]
  }
  return detectContentColumns(grey, info.width, info.height)
}

/**
 * 세트 안에서 크롭 폭이 비슷하면(±10%) 합집합 범위로 통일 —
 * 페이지마다 글자 크기가 들쭉날쭉해지지 않게. 원본 가로가 같은 것끼리만 비교한다.
 */
export function unifyCrops(crops: CropResult[]): CropResult[] {
  const out = crops.slice()
  const byWidth = new Map<number, number[]>()
  crops.forEach((c, i) => {
    if (!c.cropped) return
    const arr = byWidth.get(c.width) ?? []
    arr.push(i)
    byWidth.set(c.width, arr)
  })
  for (const idxs of byWidth.values()) {
    if (idxs.length < 2) continue
    const med = median(idxs.map((i) => crops[i].x1 - crops[i].x0))
    const similar = idxs.filter((i) => Math.abs((crops[i].x1 - crops[i].x0) - med) <= med * 0.1)
    if (similar.length < 2) continue
    const x0 = Math.min(...similar.map((i) => crops[i].x0))
    const x1 = Math.max(...similar.map((i) => crops[i].x1))
    for (const i of similar) out[i] = { ...crops[i], x0, x1 }
  }
  return out
}
