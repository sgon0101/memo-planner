/**
 * 이미지 치수 읽기 — 파일 헤더 파싱만 (디코딩 없음)
 *
 * 세로 3만 px 넘는 캡처를 모바일에서 `createImageBitmap`/<img>로 디코딩하면 실패하거나
 * 메모리가 폭주한다. 사전검사(타일 수 계산)에는 치수만 필요하므로 헤더만 읽는다.
 * PNG IHDR / JPEG SOFn / WebP VP8·VP8L·VP8X 지원.
 */

export interface ImageDims {
  width: number
  height: number
}

/** 앞부분만 먼저 읽고, JPEG SOF가 뒤에 있으면(큰 EXIF 썸네일 등) 전체 바이트를 읽는다 */
export async function readImageDims(file: Blob): Promise<ImageDims | null> {
  const head = new Uint8Array(await file.slice(0, 256 * 1024).arrayBuffer())
  const dims = parseImageDims(head)
  if (dims || file.size <= head.length) return dims
  return parseImageDims(new Uint8Array(await file.arrayBuffer()))
}

export function parseImageDims(b: Uint8Array): ImageDims | null {
  if (b.length < 24) return null
  // PNG: 89 50 4E 47 … IHDR(width, height big-endian @16, @20)
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { width: be32(b, 16), height: be32(b, 20) }
  }
  // JPEG: FF D8 … SOFn 마커 (C0~CF, 단 C4/C8/CC 제외)
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue }
      const marker = b[i + 1]
      if (marker === 0xff) { i++; continue }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue }
      const len = (b[i + 2] << 8) | b[i + 3]
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: (b[i + 5] << 8) | b[i + 6], width: (b[i + 7] << 8) | b[i + 8] }
      }
      if (marker === 0xda) return null // SOS 이후엔 SOF가 없다
      i += 2 + len
    }
    return null
  }
  // WebP: RIFF....WEBP
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') {
    const chunk = ascii(b, 12, 4)
    if (chunk === 'VP8 ' && b.length >= 30) {
      return { width: le16(b, 26) & 0x3fff, height: le16(b, 28) & 0x3fff }
    }
    if (chunk === 'VP8L' && b.length >= 25) {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
    }
    if (chunk === 'VP8X' && b.length >= 30) {
      return { width: 1 + le24(b, 24), height: 1 + le24(b, 27) }
    }
  }
  return null
}

const be32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0
const le16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8)
const le24 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)
const ascii = (b: Uint8Array, o: number, n: number) => String.fromCharCode(...b.slice(o, o + n))
