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
/** 분할 추출 청크 크기 */
export const CHUNK_SIZE = 30

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
