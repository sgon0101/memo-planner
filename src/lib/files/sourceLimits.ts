/**
 * 소스 파일 한도·형식 — 서버(presign/complete)와 클라이언트(사전검사)가 공유하는 단일 출처.
 * 두 쪽 판정이 어긋나면 "업로드 버튼은 눌리는데 서버가 거부"하는 상황이 생긴다.
 */

export const SOURCE_PDF_TYPE = 'application/pdf'
export const SOURCE_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

/** 한 번에 올릴 수 있는 이미지 장수 (한 노트로 묶임) */
export const MAX_IMAGE_COUNT = 20
/** 이미지 1장 최대 */
export const MAX_IMAGE_BYTES = 30 * 1024 * 1024
/** PDF 1개 최대 */
export const MAX_PDF_BYTES = 50 * 1024 * 1024
/** PDF 쪽수 한도 (1차) */
export const MAX_PDF_PAGES = 100

export function extForMime(mimeType: string): string {
  switch (mimeType) {
    case SOURCE_PDF_TYPE: return 'pdf'
    case 'image/png': return 'png'
    case 'image/jpeg': return 'jpg'
    case 'image/webp': return 'webp'
    default: return 'bin'
  }
}

export function isSourceMime(mimeType: string): boolean {
  return mimeType === SOURCE_PDF_TYPE || SOURCE_IMAGE_TYPES.has(mimeType)
}

/** 사람이 읽는 크기 표기 */
export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`
  return `${bytes}B`
}
