/**
 * 소스 → 타일 준비 (서버 전용) — /analyze(첫 요청)와 /extract(이어 받기)가 공유한다.
 *
 * 가공물(크롭·타일)은 저장하지 않는다는 원칙대로, 추출을 여러 요청으로 나눠도 타일은 매 요청
 * 원본에서 다시 만든다. 크롭 판정·타일 좌표는 결정적 계산이라 요청마다 같은 타일·같은 청크
 * 경계가 나온다 (호출부가 meta.tileCount와 대조해 어긋나면 중단).
 */

import { getObjectBuffer } from '@/lib/r2/presign'
import { MAX_SET_TILES } from './computeTiles'
import { detectCrop, unifyCrops, type CropResult } from './cropMargins'
import { extractPageJpegs } from './pdfInput'
import { tileImage, type ImageTile } from './tileImage'

/** 사용자에게 그대로 보여줄 입력 오류 (HTTP 상태 포함) */
export class SourceUserError extends Error {
  constructor(message: string, public status = 400) { super(message) }
}

export interface SourceFileRow {
  id: string
  r2_key: string
  public_url: string
  file_name: string
  mime_type: string
  content_hash: string | null
  compressed_size: number
  image_width: number | null
  image_height: number | null
  page_count: number | null
  is_source: boolean
}

/** 이미지 원본을 두 번(크롭 판정·타일) 읽는다 — 합계가 이 이하면 메모리에 붙잡아 둔다 */
const KEEP_BUFFERS_BYTES = 150 * 1024 * 1024

export const pdfTileLabel = (i: number, part: number, parts: number) => `[p.${i + 1} · 조각 ${part}/${parts}]`
export const imageTileLabel = (count: number) => (i: number, part: number, parts: number) =>
  `[이미지 ${i + 1}/${count} · 조각 ${part}/${parts}]`

/**
 * 크롭 판정(전 장) → 세트 통일 → 타일. 이미지별로 순차 처리해 동시 메모리 상한을 유지한다.
 */
export async function tilesFromBuffers(
  count: number,
  load: (i: number) => Promise<Buffer>,
  label: (i: number, part: number, parts: number) => string,
  cropLog?: (CropResult & { index: number })[],
): Promise<ImageTile[]> {
  const detected: CropResult[] = []
  for (let i = 0; i < count; i++) detected.push(await detectCrop(await load(i)))
  const crops = unifyCrops(detected)
  crops.forEach((c, index) => cropLog?.push({ ...c, index }))

  const tiles: ImageTile[] = []
  for (let i = 0; i < count; i++) {
    tiles.push(...await tileImage(await load(i), crops[i], (part, parts) => label(i, part, parts)))
    if (tiles.length > MAX_SET_TILES) throw new SourceUserError(`조각이 ${MAX_SET_TILES}개를 넘어요 — 이미지 수를 줄여주세요.`)
  }
  return tiles
}

/** 이미지 묶음 로더 (합계가 크지 않으면 버퍼 재사용) */
export function imageLoader(files: SourceFileRow[]): (i: number) => Promise<Buffer> {
  const totalBytes = files.reduce((s, f) => s + (f.compressed_size ?? 0), 0)
  const keep = totalBytes <= KEEP_BUFFERS_BYTES
  const kept = new Map<number, Buffer>()
  return async (i: number) => {
    const hit = kept.get(i)
    if (hit) return hit
    const buf = await getObjectBuffer(files[i].r2_key)
    if (!buf) throw new SourceUserError(`${files[i].file_name} 원본을 읽지 못했어요.`, 404)
    if (keep) kept.set(i, buf)
    return buf
  }
}

/** 이어 받기용: 저장된 meta.mode대로 원본에서 타일을 다시 만든다 */
export async function loadSourceTiles(files: SourceFileRow[], mode: 'image-pdf' | 'images'): Promise<ImageTile[]> {
  if (mode === 'image-pdf') {
    const buffer = await getObjectBuffer(files[0].r2_key)
    if (!buffer) throw new SourceUserError('원본 PDF를 읽지 못했어요. 다시 올려주세요.', 404)
    const pages = await extractPageJpegs(buffer)
    if (!pages.ok) throw new Error(`페이지 이미지를 다시 꺼내지 못했어요 (${pages.reason})`)
    return tilesFromBuffers(pages.jpegs.length, async (i) => pages.jpegs[i], pdfTileLabel)
  }
  return tilesFromBuffers(files.length, imageLoader(files), imageTileLabel(files.length))
}
