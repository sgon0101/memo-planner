/**
 * 이미지 타일 좌표 계산 — 순수 함수 (서버 분석·클라이언트 사전검사 공용)
 *
 * Claude 비전은 긴 변 1568px / 약 1.15MP 초과 시 자동 축소, 8000px 초과는 거부한다.
 * 긴 캡처를 그대로 넣으면 글자가 뭉개지므로 세로로 잘라 여러 장으로 보낸다.
 *
 * 한도 판정(총 150개)은 서버·클라이언트 모두 **원본 치수**로 이 함수를 호출해 일치시킨다.
 * (실제 처리 타일 수는 여백 크롭 후 폭이 달라져 약간 달라질 수 있다)
 */

export const TILE_MAX_WIDTH = 1568
export const TILE_MAX_PIXELS = 1_150_000
export const TILE_OVERLAP = 80
/** 세트 총 타일 한도 */
export const MAX_SET_TILES = 150
/** 이 개수를 넘으면 분할 추출 → 종합 2단계 */
export const CHUNK_THRESHOLD = 40
/**
 * 분할 추출 청크 크기 — 설계안은 30이었으나 E2E에서 글자가 빽빽한 캡처 30조각의 전사문이
 * 출력 한도를 넘어 잘렸다(→ 부분 요약 금지 에러). 15조각도 실제 63분 분량 기사 캡처에서 잘려 10조각.
 */
export const CHUNK_SIZE = 10
/** 타일 높이를 이 배율 이내로 넘으면 분할 대신 살짝 축소 */
const SLIGHT_OVERFLOW = 1.15

export interface TilePlan {
  /** 축소 후 가로 */
  width: number
  /** 축소 후 세로 */
  height: number
  /** 원본 → 축소 배율 (≤ 1) */
  scale: number
  /** 축소 좌표계 기준 타일 (top, height) */
  tiles: { top: number; height: number }[]
}

export function computeTiles(width: number, height: number): TilePlan {
  const w0 = Math.max(1, Math.round(width))
  const h0 = Math.max(1, Math.round(height))
  const scale = w0 > TILE_MAX_WIDTH ? TILE_MAX_WIDTH / w0 : 1
  const w = Math.max(1, Math.round(w0 * scale))
  const h = Math.max(1, Math.round(h0 * scale))
  const tileH = Math.max(TILE_OVERLAP + 1, Math.min(TILE_MAX_WIDTH, Math.floor(TILE_MAX_PIXELS / w)))

  if (h <= tileH) return { width: w, height: h, scale, tiles: [{ top: 0, height: h }] }

  // 타일 높이를 조금(15% 이내)만 넘는 이미지 — 예: 1080×1080 카드뉴스는 1.17MP라 그대로면
  // 80px 겹침 2조각이 되어 비용이 2배. 쪼개지 않고 1.15MP 이하로 살짝 축소해 1장으로 보낸다.
  if (h <= tileH * SLIGHT_OVERFLOW) {
    const s = Math.min(Math.sqrt(TILE_MAX_PIXELS / (w * h)), TILE_MAX_WIDTH / h, 1)
    const w2 = Math.max(1, Math.floor(w * s))
    const h2 = Math.max(1, Math.floor(h * s))
    return { width: w2, height: h2, scale: scale * s, tiles: [{ top: 0, height: h2 }] }
  }

  const step = tileH - TILE_OVERLAP
  const count = Math.ceil((h - TILE_OVERLAP) / step)
  const tiles: { top: number; height: number }[] = []
  for (let i = 0; i < count; i++) {
    // 마지막 타일은 바닥에 맞춘다 (겹침이 조금 늘어날 뿐 누락은 없다)
    const top = Math.min(i * step, h - tileH)
    tiles.push({ top, height: tileH })
  }
  return { width: w, height: h, scale, tiles }
}

export function countTiles(width: number, height: number): number {
  return computeTiles(width, height).tiles.length
}

/**
 * 타일 인덱스 배열을 청크로 나눈다 — 청크 경계는 타일 1개를 공유한다
 * (경계에서 잘린 문장이 한쪽 청크에서라도 온전히 보이도록).
 * 반환: 각 청크의 [start, end) 인덱스
 */
export function chunkRanges(total: number, size = CHUNK_SIZE): [number, number][] {
  if (total <= 0) return []
  const ranges: [number, number][] = []
  let start = 0
  for (;;) {
    const end = Math.min(total, start + size)
    ranges.push([start, end])
    if (end >= total) break
    start = end - 1 // 겹침 타일 1개
  }
  return ranges
}
