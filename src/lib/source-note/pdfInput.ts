/**
 * PDF 입력 어댑터 — 서버 전용
 *
 * 텍스트형 / 이미지형 분기:
 *  - unpdf(서버리스 pdf.js)로 페이지별 텍스트 추출 → 평균 30자/페이지 이상이면 '텍스트형'
 *    → Claude document 블록(URL)으로 그대로 보낸다.
 *  - 미만이면 '이미지형'(웹페이지 전체 캡처·스캔) → pdf-lib로 페이지마다 가장 큰 이미지
 *    XObject를 찾아, DCTDecode(JPEG)면 스트림 바이트 = JPEG 원본을 그대로 꺼낸다.
 *    모든 페이지 성공 시 이미지 세트로 크롭 → 타일 파이프라인에 태운다.
 *    하나라도 실패(JBIG2/CCITT/Flate, 여러 이미지 조합 등)하면 null → 호출부가 URL 방식으로 폴백.
 *
 * 왜: jsPDF 캡처 PDF는 텍스트 0자 + 페이지당 JPEG 1장(1920×2524)이고 본문 칼럼은 폭의 35%뿐.
 * PDF를 그대로 넘기면 Claude가 페이지를 1568px로 줄이면서 본문이 ~420px로 뭉개진다.
 *
 * ⚠️ 원본 PDF는 변경하지 않는다 — 추출한 페이지 JPEG도 메모리에서만 쓴다.
 */

import { PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRawStream, PDFStream, decodePDFRawStream } from 'pdf-lib'

/** 이 평균 글자 수 이상이면 텍스트형 */
export const TEXT_PDF_MIN_CHARS_PER_PAGE = 30

export interface PdfTextInfo {
  pageCount: number
  avgChars: number
  isTextPdf: boolean
}

export async function inspectPdfText(buffer: Buffer): Promise<PdfTextInfo> {
  const { extractText, getDocumentProxy } = await import('unpdf')
  // pdf.js가 입력 버퍼를 transfer할 수 있으므로 복사본을 넘긴다
  const doc = await getDocumentProxy(new Uint8Array(buffer))
  try {
    const { totalPages, text } = await extractText(doc, { mergePages: false })
    const chars = text.reduce((s, t) => s + t.replace(/\s+/g, '').length, 0)
    const avgChars = totalPages > 0 ? chars / totalPages : 0
    return { pageCount: totalPages, avgChars, isTextPdf: avgChars >= TEXT_PDF_MIN_CHARS_PER_PAGE }
  } finally {
    await doc.cleanup().catch(() => {})
  }
}

export type PageJpegResult =
  | { ok: true; jpegs: Buffer[] }
  | { ok: false; reason: string }

/** 이미지형 PDF → 페이지별 JPEG 원본 바이트 (모든 페이지 성공 시에만) */
export async function extractPageJpegs(buffer: Buffer): Promise<PageJpegResult> {
  let doc: PDFDocument
  try {
    doc = await PDFDocument.load(new Uint8Array(buffer), { ignoreEncryption: true, updateMetadata: false })
  } catch (e) {
    return { ok: false, reason: `pdf-lib load 실패: ${e instanceof Error ? e.message : e}` }
  }

  const jpegs: Buffer[] = []
  const pages = doc.getPages()
  for (let p = 0; p < pages.length; p++) {
    const resources = pages[p].node.normalizedEntries().Resources
    const xobjects = resources?.lookupMaybe(PDFName.of('XObject'), PDFDict)
    if (!xobjects) return { ok: false, reason: `p.${p + 1}: 이미지 없음` }

    // 이 쪽이 실제로 그리는 XObject만 본다. jsPDF 캡처 PDF는 모든 쪽이 리소스 사전 하나를
    // 공유하고(이미지 20장이 전부 들어 있음) 쪽마다 그중 1장만 `/Ik Do`로 그린다 —
    // 리소스 전체를 보면 모든 쪽이 "여러 이미지 조합"으로 오판된다 (실제 파일 실측).
    const drawn = drawnXObjectNames(pages[p].node.Contents(), doc)
    if (drawn === null) return { ok: false, reason: `p.${p + 1}: 콘텐츠 스트림을 읽지 못함` }

    const images: { stream: PDFRawStream; area: number; filter: string }[] = []
    for (const [name, ref] of xobjects.entries()) {
      if (!drawn.has(name.decodeText().replace(/^\//, ''))) continue
      const obj = doc.context.lookup(ref)
      // 그리는 것이 Form XObject(중첩)면 안쪽 구성을 알 수 없다 → 폴백
      if (obj instanceof PDFRawStream && obj.dict.get(PDFName.of('Subtype')) === PDFName.of('Form')) {
        return { ok: false, reason: `p.${p + 1}: Form XObject 중첩` }
      }
      if (!(obj instanceof PDFRawStream)) continue
      const dict = obj.dict
      if (dict.get(PDFName.of('Subtype')) !== PDFName.of('Image')) continue
      const w = dict.lookupMaybe(PDFName.of('Width'), PDFNumber)?.asNumber() ?? 0
      const h = dict.lookupMaybe(PDFName.of('Height'), PDFNumber)?.asNumber() ?? 0
      images.push({ stream: obj, area: w * h, filter: filterName(dict) })
    }
    if (images.length === 0) return { ok: false, reason: `p.${p + 1}: 이미지 XObject 없음(Form 중첩 등)` }

    images.sort((a, b) => b.area - a.area)
    const main = images[0]
    // 여러 이미지를 조합한 페이지 — 가장 큰 1장만으로는 내용이 빠진다
    if (images.slice(1).some((im) => im.area >= main.area * 0.05)) {
      return { ok: false, reason: `p.${p + 1}: 여러 이미지 조합 페이지` }
    }
    if (main.filter !== 'DCTDecode') {
      return { ok: false, reason: `p.${p + 1}: 지원하지 않는 이미지 필터 ${main.filter || '없음'}` }
    }
    const bytes = Buffer.from(main.stream.contents)
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
      return { ok: false, reason: `p.${p + 1}: JPEG 시그니처 불일치` }
    }
    jpegs.push(bytes)
  }
  return { ok: true, jpegs }
}

/**
 * 쪽 콘텐츠 스트림(들)을 풀어 `/이름 Do` 연산자로 그리는 XObject 이름 집합을 얻는다.
 * 풀 수 없는 필터 등으로 실패하면 null (호출부가 폴백).
 */
function drawnXObjectNames(contents: PDFStream | PDFArray | undefined, doc: PDFDocument): Set<string> | null {
  if (!contents) return new Set()
  const streams: PDFRawStream[] = []
  const push = (o: unknown) => { if (o instanceof PDFRawStream) streams.push(o) }
  if (contents instanceof PDFArray) {
    for (const ref of contents.asArray()) push(doc.context.lookup(ref))
  } else {
    push(contents)
  }
  const names = new Set<string>()
  try {
    for (const s of streams) {
      const bytes = decodePDFRawStream(s).decode()
      const text = Buffer.from(bytes).toString('latin1')
      for (const m of text.matchAll(/\/([^\s/[\]()<>{}%]+)\s+Do\b/g)) names.add(m[1])
    }
  } catch {
    return null
  }
  return names
}

function filterName(dict: PDFDict): string {
  const f = dict.get(PDFName.of('Filter'))
  if (f instanceof PDFName) return f.decodeText()
  if (f instanceof PDFArray) {
    // 단일 필터 배열만 허용 ([/DCTDecode]) — 체인([/FlateDecode /DCTDecode])은 원본 JPEG가 아니다
    if (f.size() !== 1) return f.asArray().map((x) => (x instanceof PDFName ? x.decodeText() : '?')).join('+')
    const only = f.get(0)
    return only instanceof PDFName ? only.decodeText() : ''
  }
  return ''
}
