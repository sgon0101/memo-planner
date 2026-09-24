/**
 * POST /api/ai/source-note/analyze — 소스 세트(PDF 1개 또는 이미지 1~20장) → 요약 노트 재료
 *
 * 입력: { fileIds: string[] (순서대로), force?: boolean }
 *
 * 파이프라인은 하나, 입력 어댑터만 2개:
 *  - 텍스트형 PDF  → document 블록(URL, 실패 시 1회 base64)
 *  - 이미지형 PDF  → 페이지 JPEG 추출 → 여백 크롭 → 타일  (추출 실패 시 URL 폴백)
 *  - 이미지 묶음   → 여백 크롭 → 타일
 *  - 타일 > 40    → 분할 추출(30개씩, 병렬 3) → 텍스트 종합
 *
 * 캐시: source_analyses(user_id, source_key) 히트 + force 아님 → AI 호출·한도 차감 없음.
 * force일 때 분할 추출문이 저장돼 있으면 추출은 재사용하고 종합만 다시 호출한다.
 *
 * ⚠️ 저장은 원본 그대로 — 크롭·타일·페이지 JPEG는 이 요청의 메모리에서만 쓰고 버린다.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import { getObjectBuffer } from '@/lib/r2/presign'
import { checkRateLimit, rateLimitResponse } from '@/lib/security/rateLimit'
import { MAX_IMAGE_COUNT, MAX_PDF_PAGES, SOURCE_IMAGE_TYPES, SOURCE_PDF_TYPE } from '@/lib/files/sourceLimits'
import { CHUNK_THRESHOLD, MAX_SET_TILES, countTiles } from '@/lib/source-note/computeTiles'
import { detectCrop, unifyCrops, type CropResult } from '@/lib/source-note/cropMargins'
import { reencodeIfTooLarge, tileImage, type ImageTile } from '@/lib/source-note/tileImage'
import { extractPageJpegs, inspectPdfText } from '@/lib/source-note/pdfInput'
import { chunksToText, extractChunks } from '@/lib/source-note/chunkedExtract'
import {
  TruncatedError, callSourceNote, estimateCostUsd, tileBlocks, type UsageEntry,
} from '@/lib/source-note/claudeCall'
import { buildVocab, findNeighbors, normalizeAnalysis } from '@/lib/source-note/postprocess'
import type { AnalyzeResponse, ChunkExtract, SourceMeta, StoredAnalysis } from '@/lib/source-note/types'

export const runtime = 'nodejs'
export const maxDuration = 300

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** 이미지 원본을 두 번(크롭 판정·타일) 읽는다 — 합계가 이 이하면 메모리에 붙잡아 둔다 */
const KEEP_BUFFERS_BYTES = 150 * 1024 * 1024
/** base64 PDF 폴백 한도 (요청 전체 32MB 제한에 여유) */
const MAX_BASE64_PDF = 31 * 1024 * 1024

interface FileRow {
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

class UserError extends Error {
  constructor(message: string, public status = 400) { super(message) }
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })

  let body: { fileIds?: unknown; force?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '잘못된 요청 형식입니다.' }, { status: 400 })
  }
  const fileIds = Array.isArray(body.fileIds) ? body.fileIds.filter((x): x is string => typeof x === 'string' && UUID_RE.test(x)) : []
  const force = body.force === true
  if (fileIds.length === 0 || fileIds.length !== (body.fileIds as unknown[]).length) {
    return NextResponse.json({ error: '파일 정보가 올바르지 않습니다.' }, { status: 400 })
  }
  if (new Set(fileIds).size !== fileIds.length) {
    return NextResponse.json({ error: '같은 파일이 중복으로 들어 있어요.' }, { status: 400 })
  }

  try {
    // ── 파일 조회 + 검증 (본인 소스 파일만, 입력 순서 유지) ──
    const { data: rowsData, error: rowsErr } = await supabase
      .from('uploaded_files')
      .select('id, r2_key, public_url, file_name, mime_type, content_hash, compressed_size, image_width, image_height, page_count, is_source')
      .eq('user_id', user.id)
      .in('id', fileIds)
    if (rowsErr) throw new Error(`파일 조회 실패: ${rowsErr.message}`)
    const byId = new Map(((rowsData ?? []) as FileRow[]).map((r) => [r.id, r]))
    const files = fileIds.map((id) => byId.get(id)).filter((r): r is FileRow => !!r)
    if (files.length !== fileIds.length) throw new UserError('파일을 찾을 수 없어요. 다시 올려주세요.', 404)
    if (files.some((f) => !f.is_source || !f.content_hash)) throw new UserError('요약할 수 없는 파일이 섞여 있어요.')

    const isPdf = files[0].mime_type === SOURCE_PDF_TYPE
    if (files.some((f) => (f.mime_type === SOURCE_PDF_TYPE) !== isPdf)) throw new UserError('PDF와 이미지는 한 번에 함께 요약할 수 없어요.')
    if (isPdf && files.length !== 1) throw new UserError('PDF는 1개씩 요약할 수 있어요.')
    if (!isPdf && files.some((f) => !SOURCE_IMAGE_TYPES.has(f.mime_type))) throw new UserError('지원하지 않는 이미지 형식이에요.')
    if (!isPdf && files.length > MAX_IMAGE_COUNT) throw new UserError(`이미지는 ${MAX_IMAGE_COUNT}장까지 묶을 수 있어요.`)
    if (isPdf && (files[0].page_count ?? 0) > MAX_PDF_PAGES) throw new UserError(`PDF는 ${MAX_PDF_PAGES}쪽까지 요약할 수 있어요.`)
    if (!isPdf) {
      // 한도 판정은 클라이언트와 같은 함수·같은 입력(원본 치수)으로
      const total = files.reduce((s, f) => s + (f.image_width && f.image_height ? countTiles(f.image_width, f.image_height) : 0), 0)
      if (total > MAX_SET_TILES) throw new UserError(`총 조각 ${total}개 — ${MAX_SET_TILES}개 이하로 줄여주세요.`)
    }

    const kind: 'pdf' | 'images' = isPdf ? 'pdf' : 'images'
    const sourceKey = createHash('sha256').update(`${kind}:${files.map((f) => f.content_hash).join('')}`).digest('hex')

    // ── 캐시 ──
    const { data: cached } = await supabase
      .from('source_analyses')
      .select('id, analysis, created_at')
      .eq('user_id', user.id)
      .eq('source_key', sourceKey)
      .maybeSingle()
    if (cached && !force) {
      const stored = cached.analysis as StoredAnalysis
      return NextResponse.json({
        analysisId: cached.id,
        analysis: stored.result,
        related: stored.related ?? [],
        meta: stored.meta,
        cached: true,
        createdAt: cached.created_at,
      } satisfies AnalyzeResponse)
    }

    const rate = await checkRateLimit(supabase, 'ai-source-note')
    if (!rate.ok) return rateLimitResponse(rate.message)

    const vocab = await buildVocab(supabase, user.id)
    const vocabForPrompt = { wikis: vocab.wikiList, tags: vocab.tagList }
    const usage: UsageEntry[] = []
    const crops: (CropResult & { index: number })[] = []

    let raw: Record<string, unknown>
    let meta: SourceMeta
    let extracted: ChunkExtract[] | undefined
    const prevStored = cached?.analysis as StoredAnalysis | undefined

    if (force && prevStored?.extracted?.length) {
      // [다시 분석] — 분할 추출문 재사용, 종합만 다시
      extracted = prevStored.extracted
      meta = prevStored.meta
      raw = await callSourceNote('chunks', [{ type: 'text', text: chunksToText(extracted) }], vocabForPrompt, usage, 'synthesis(reuse)')
    } else if (isPdf) {
      const file = files[0]
      const buffer = await getObjectBuffer(file.r2_key)
      if (!buffer) throw new UserError('원본 PDF를 읽지 못했어요. 다시 올려주세요.', 404)
      const info = await inspectPdfText(buffer)
      if (info.pageCount > MAX_PDF_PAGES) throw new UserError(`${info.pageCount}쪽 — PDF는 ${MAX_PDF_PAGES}쪽까지 요약할 수 있어요.`)
      if (file.page_count !== info.pageCount) {
        await supabase.from('uploaded_files').update({ page_count: info.pageCount }).eq('id', file.id)
      }

      const baseMeta: SourceMeta = {
        kind, mode: 'text-pdf', fileNames: [file.file_name], pageCount: info.pageCount,
        imageCount: 0, tileCount: 0, chunked: false,
      }

      if (info.isTextPdf) {
        meta = baseMeta
        raw = await callPdfDocument(file, buffer, vocabForPrompt, usage)
      } else {
        const pages = await extractPageJpegs(buffer)
        if (pages.ok) {
          const r = await runImageSet(pages.jpegs.length, async (i) => pages.jpegs[i], (i, part, parts) => `[p.${i + 1} · 조각 ${part}/${parts}]`, 'image-pdf', vocabForPrompt, usage, crops)
          raw = r.raw
          extracted = r.extracted
          meta = { ...baseMeta, mode: 'image-pdf', imageCount: pages.jpegs.length, tileCount: r.tileCount, chunked: !!r.extracted }
        } else {
          console.error('[source-note] image-pdf-fallback', JSON.stringify({ file: file.id, reason: pages.reason, avgChars: info.avgChars }))
          meta = { ...baseMeta, mode: 'image-pdf-fallback' }
          raw = await callPdfDocument(file, buffer, vocabForPrompt, usage)
        }
      }
    } else {
      const totalBytes = files.reduce((s, f) => s + (f.compressed_size ?? 0), 0)
      const keep = totalBytes <= KEEP_BUFFERS_BYTES
      const kept = new Map<number, Buffer>()
      const load = async (i: number) => {
        const hit = kept.get(i)
        if (hit) return hit
        const buf = await getObjectBuffer(files[i].r2_key)
        if (!buf) throw new UserError(`${files[i].file_name} 원본을 읽지 못했어요.`, 404)
        if (keep) kept.set(i, buf)
        return buf
      }
      const r = await runImageSet(files.length, load, (i, part, parts) => `[이미지 ${i + 1}/${files.length} · 조각 ${part}/${parts}]`, 'images', vocabForPrompt, usage, crops)
      raw = r.raw
      extracted = r.extracted
      meta = {
        kind, mode: 'images', fileNames: files.map((f) => f.file_name), pageCount: null,
        imageCount: files.length, tileCount: r.tileCount, chunked: !!r.extracted,
      }
    }

    // ── 후처리 (프롬프트를 믿지 않는다) ──
    const analysis = normalizeAnalysis(raw, vocab)
    const { related, neighbors } = await findNeighbors(supabase, user.id, analysis, vocab)
    analysis.wikiSuggestions.push(...neighbors)

    const stored: StoredAnalysis = { result: analysis, related, meta, ...(extracted ? { extracted } : {}) }
    const costUsd = estimateCostUsd(usage)
    const usageDoc = { calls: usage, costUsd, crops: crops.length ? crops : undefined }
    console.error('[source-note] done', JSON.stringify({ mode: meta.mode, tiles: meta.tileCount, chunked: meta.chunked, costUsd, crops: crops.map((c) => [c.index, c.x0, c.x1, c.width, c.cropped]) }))

    const { data: saved, error: saveErr } = await supabase
      .from('source_analyses')
      .upsert({
        user_id: user.id,
        source_key: sourceKey,
        kind,
        file_ids: fileIds,
        analysis: stored,
        usage: usageDoc,
        created_at: new Date().toISOString(),
      }, { onConflict: 'user_id,source_key' })
      .select('id, created_at')
      .single()
    if (saveErr || !saved) throw new Error(`분석 결과 저장 실패: ${saveErr?.message}`)

    return NextResponse.json({
      analysisId: saved.id,
      analysis,
      related,
      meta,
      cached: false,
      createdAt: saved.created_at,
    } satisfies AnalyzeResponse)
  } catch (e) {
    if (e instanceof UserError) return NextResponse.json({ error: e.message }, { status: e.status })
    if (e instanceof TruncatedError) return NextResponse.json({ error: e.message }, { status: 502 })
    if (e instanceof Anthropic.APIError) {
      console.error('[source-note] anthropic', e.status, e.message)
      const msg = e.status === 429 || e.status === 529
        ? 'AI 서버가 바빠요. 잠시 후 다시 시도해주세요.'
        : 'AI 분석에 실패했어요. 잠시 후 다시 시도해주세요.'
      return NextResponse.json({ error: msg }, { status: 502 })
    }
    console.error('[source-note] analyze 실패:', e)
    const msg = e instanceof Error && /읽지 못했어요|잘렸어요/.test(e.message) ? e.message : '분석에 실패했어요. 다시 시도해주세요.'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

/** 텍스트형(또는 폴백) PDF — URL document, URL fetch 실패 시 1회 base64 */
async function callPdfDocument(
  file: FileRow,
  buffer: Buffer,
  vocab: { wikis: string[]; tags: string[] },
  usage: UsageEntry[],
): Promise<Record<string, unknown>> {
  try {
    return await callSourceNote('pdf', [{ type: 'document', source: { type: 'url', url: file.public_url } }], vocab, usage)
  } catch (e) {
    const urlFailure = e instanceof Anthropic.APIError && e.status === 400 && /url|download|fetch|retriev/i.test(e.message)
    const b64Size = Math.ceil(buffer.length / 3) * 4
    if (!urlFailure || b64Size > MAX_BASE64_PDF) throw e
    console.error('[source-note] pdf url fetch 실패 → base64 폴백', e.message)
    return callSourceNote('pdf', [{
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') },
    }], vocab, usage, 'summary(base64)')
  }
}

/**
 * 이미지 세트 공통: 크롭 판정(전 장) → 세트 통일 → 타일 → 요약 (또는 분할 추출 → 종합)
 * 이미지별로 순차 처리해 동시 메모리 상한을 유지한다.
 */
async function runImageSet(
  count: number,
  load: (i: number) => Promise<Buffer>,
  label: (i: number, part: number, parts: number) => string,
  promptKind: 'images' | 'image-pdf',
  vocab: { wikis: string[]; tags: string[] },
  usage: UsageEntry[],
  cropLog: (CropResult & { index: number })[],
): Promise<{ raw: Record<string, unknown>; extracted?: ChunkExtract[]; tileCount: number }> {
  const detected: CropResult[] = []
  for (let i = 0; i < count; i++) detected.push(await detectCrop(await load(i)))
  const crops = unifyCrops(detected)
  crops.forEach((c, index) => cropLog.push({ ...c, index }))

  const tiles: ImageTile[] = []
  for (let i = 0; i < count; i++) {
    tiles.push(...await tileImage(await load(i), crops[i], (part, parts) => label(i, part, parts)))
    if (tiles.length > MAX_SET_TILES) throw new UserError(`조각이 ${MAX_SET_TILES}개를 넘어요 — 이미지 수를 줄여주세요.`)
  }

  if (tiles.length <= CHUNK_THRESHOLD) {
    const safe = await reencodeIfTooLarge(tiles)
    const raw = await callSourceNote(promptKind, tileBlocks(safe), vocab, usage)
    return { raw, tileCount: tiles.length }
  }

  const extracted = await extractChunks(tiles, usage)
  const raw = await callSourceNote('chunks', [{ type: 'text', text: chunksToText(extracted) }], vocab, usage, 'synthesis')
  return { raw, extracted, tileCount: tiles.length }
}
