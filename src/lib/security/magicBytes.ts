// 업로드 파일 시그니처(magic bytes) 검증
// 클라이언트가 보낸 Content-Type 헤더는 위조 가능 — 실제 바이트를 확인해
// .exe 등을 image/jpeg로 변장해 업로드하는 것을 차단한다.

function startsWith(buf: Buffer, bytes: number[], offset = 0): boolean {
  if (buf.length < offset + bytes.length) return false
  return bytes.every((b, i) => buf[offset + i] === b)
}

function asciiAt(buf: Buffer, text: string, offset = 0): boolean {
  return startsWith(buf, [...text].map((c) => c.charCodeAt(0)), offset)
}

/** 선언된 MIME 타입과 실제 파일 시그니처가 일치하는지 검증 */
export function matchesMagicBytes(buf: Buffer, declaredMime: string): boolean {
  switch (declaredMime) {
    case 'image/jpeg':
      return startsWith(buf, [0xff, 0xd8, 0xff])
    case 'image/png':
      return startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    case 'image/gif':
      return asciiAt(buf, 'GIF87a') || asciiAt(buf, 'GIF89a')
    case 'image/webp':
      return asciiAt(buf, 'RIFF') && asciiAt(buf, 'WEBP', 8)
    case 'image/svg+xml': {
      // 텍스트 포맷 — 앞부분 1KB에 <svg 태그가 있어야 함 (BOM/주석/xml 선언 허용)
      const head = buf.subarray(0, 1024).toString('utf8').toLowerCase()
      return head.includes('<svg')
    }
    case 'video/mp4':
      return asciiAt(buf, 'ftyp', 4)
    case 'video/webm':
      return startsWith(buf, [0x1a, 0x45, 0xdf, 0xa3]) // EBML (Matroska/WebM)
    case 'video/ogg':
      return asciiAt(buf, 'OggS')
    case 'application/pdf':
      return asciiAt(buf, '%PDF-')
    default:
      return false // 허용 목록 밖 타입은 애초에 차단
  }
}
