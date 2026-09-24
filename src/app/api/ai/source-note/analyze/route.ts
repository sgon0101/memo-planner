/**
 * POST /api/ai/source-note/analyze — 소스 세트(PDF 1개 또는 이미지 1~20장) → 요약 노트 재료
 *
 * 입력: { fileIds: string[] (순서대로), force?: boolean }
 *
 * 파이프라인은 하나, 입력 어댑터만 2개:
 *  - 텍스트형 PDF  → document 블록(URL, 실패 시 1회 base64)
 *  - 이미지형 PDF  → 페이지 JPEG 추출 → 여백 크롭 → 타일  (추출 실패 시 URL 폴백)
 *  - 이미지 묶음   → 여백 크롭 → 타일
 *  - 타일 > 40    → 분할 경로 (Vercel 300초 한도 때문에 요청을 나눈다):
 *                   이 요청은 **추출 1차수(최대 5청크)만** 하고 청크 단위로 누적 캐시(phase
 *                   'extracting' / 다 끝나면 'extracted'), 남은 청크는 클라이언트가 /extract로
 *                   이어서, 종합은 /synthesize로 요청한다.
 *
 * 응답: 단일 호출 경로는 phase 'done'(완성 결과), 분할 경로는 'extracting'(→ /extract) 또는
 *       'extracted'(→ /synthesize).
 * 캐시: source_analyses(user_id, source_key) 히트 + force 아님 → AI 호출·한도 차감 없음
 *       (진행 중이던 분할 분석이면 그 단계를 돌려줘 남은 것만 이어서 하게 한다).
 * force: 분할 추출이 끝난 캐시면 추출은 재사용 — 'extracted'로 되돌리고 종합만 다시.
 * 한도(ai-source-note)는 이 요청에서만, 실제 AI 작업을 시작할 때 1회 차감한다.
 *       /extract·/synthesize는 해당 phase일 때만 AI를 호출하므로 추가 차감 없이 1회로 묶인다.
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
import { type CropResult } from '@/lib/source-note/cropMargins'
import { reencodeIfTooLarge, type ImageTile } from '@/lib/source-note/tileImage'
import { extractPageJpegs, inspectPdfText } from '@/lib/source-note/pdfInput'
import { chunkCount, extractChunkAt } from '@/lib/source-note/chunkedExtract'
import { advanceExtraction, toPhaseResponse, type RoundResult } from '@/lib/source-note/extractRounds'
import {
  SourceUserError, imageLoader, imageTileLabel, pdfTileLabel, tilesFromBuffers, type SourceFileRow,
} from '@/lib/source-note/sourceTiles'
import { callSourceNote, estimateCostUsd, tileBlocks, type UsageEntry } from '@/lib/source-note/claudeCall'
import { sourceNoteErrorResponse } from '@/lib/source-note/routeErrors'
import { buildVocab, finalizeAnalysis } from '@/lib/source-note/postprocess'
import type { AnalyzeResponse, SourceMeta, StoredAnalysis } from '@/lib/source-note/types'

export const runtime = 'nodejs'
export const maxDuration = 300

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** base64 PDF 폴백 한도 (요청 전체 32MB 제한에 여유) */
const MAX_BASE64_PDF = 31 * 1024 * 1024

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

  // 실패해도 이미 쓴 토큰은 기록한다 (실패 분석의 비용이 보이지 않게 되지 않도록)
  const usage: UsageEntry[] = []
  try {
    // ── 파일 조회 + 검증 (본인 소스 파일만, 입력 순서 유지) ──
    const { data: rowsData, error: rowsErr } = await supabase
      .from('uploaded_files')
      .select('id, r2_key, public_url, file_name, mime_type, content_hash, compressed_size, image_width, image_height, page_count, is_source')
      .eq('user_id', user.id)
      .in('id', fileIds)
    if (rowsErr) throw new Error(`파일 조회 실패: ${rowsErr.message}`)
    const byId = new Map(((rowsData ?? []) as SourceFileRow[]).map((r) => [r.id, r]))
    const files = fileIds.map((id) => byId.get(id)).filter((r): r is SourceFileRow => !!r)
    if (files.length !== fileIds.length) throw new SourceUserError('파일을 찾을 수 없어요. 다시 올려주세요.', 404)
    if (files.some((f) => !f.is_source || !f.content_hash)) throw new SourceUserError('요약할 수 없는 파일이 섞여 있어요.')

    const isPdf = files[0].mime_type === SOURCE_PDF_TYPE
    if (files.some((f) => (f.mime_type === SOURCE_PDF_TYPE) !== isPdf)) throw new SourceUserError('PDF와 이미지는 한 번에 함께 요약할 수 없어요.')
    if (isPdf && files.length !== 1) throw new SourceUserError('PDF는 1개씩 요약할 수 있어요.')
    if (!isPdf && files.some((f) => !SOURCE_IMAGE_TYPES.has(f.mime_type))) throw new SourceUserError('지원하지 않는 이미지 형식이에요.')
    if (!isPdf && files.length > MAX_IMAGE_COUNT) throw new SourceUserError(`이미지는 ${MAX_IMAGE_COUNT}장까지 묶을 수 있어요.`)
    if (isPdf && (files[0].page_count ?? 0) > MAX_PDF_PAGES) throw new SourceUserError(`PDF는 ${MAX_PDF_PAGES}쪽까지 요약할 수 있어요.`)
    if (!isPdf) {
      // 한도 판정은 클라이언트와 같은 함수·같은 입력(원본 치수)으로
      const total = files.reduce((s, f) => s + (f.image_width && f.image_height ? countTiles(f.image_width, f.image_height) : 0), 0)
      if (total > MAX_SET_TILES) throw new SourceUserError(`총 조각 ${total}개 — ${MAX_SET_TILES}개 이하로 줄여주세요.`)
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
    const prevStored = cached?.analysis as StoredAnalysis | undefined

    // 추출이 진행 중이던 분할 분석 — force여도 새로 시작하지 않고 남은 청크만 이어서 (AI·한도 차감 없음)
    if (cached && prevStored?.phase === 'extracting') {
      return NextResponse.json(toPhaseResponse(cached.id, prevStored, true))
    }
    if (cached && prevStored && !force) {
      // 추출만 끝나고 종합이 안 된(또는 실패한) 캐시 → 종합만 이어서
      if (prevStored.phase === 'extracted' || !prevStored.result) {
        return NextResponse.json(toPhaseResponse(cached.id, prevStored, true))
      }
      return NextResponse.json({
        phase: 'done',
        analysisId: cached.id,
        analysis: prevStored.result,
        related: prevStored.related ?? [],
        meta: prevStored.meta,
        cached: true,
        createdAt: cached.created_at,
      } satisfies AnalyzeResponse)
    }

    const rate = await checkRateLimit(supabase, 'ai-source-note')
    if (!rate.ok) return rateLimitResponse(rate.message)

    if (force && cached && prevStored?.extracted?.length) {
      // [다시 분석] — 끝난 분할 추출문 재사용. 종합 대기 상태로 되돌리고 /synthesize로 넘긴다
      // (이전 결과는 종합이 끝날 때까지 남겨 둔다 — 실패해도 잃지 않게)
      const reset: StoredAnalysis = { ...prevStored, phase: 'extracted' }
      const { error: updErr } = await supabase.from('source_analyses').update({ analysis: reset }).eq('id', cached.id)
      if (updErr) throw new Error(`재분석 준비 실패: ${updErr.message}`)
      return NextResponse.json(toPhaseResponse(cached.id, reset, true))
    }

    const vocab = await buildVocab(supabase, user.id)
    const vocabForPrompt = { wikis: vocab.wikiList, tags: vocab.tagList }
    const crops: (CropResult & { index: number })[] = []

    // 어댑터 결과: 단일 호출(raw) 또는 분할 경로의 타일
    let raw: Record<string, unknown> | undefined
    let tilesForChunks: ImageTile[] | undefined
    let meta: SourceMeta

    if (isPdf) {
      const file = files[0]
      const buffer = await getObjectBuffer(file.r2_key)
      if (!buffer) throw new SourceUserError('원본 PDF를 읽지 못했어요. 다시 올려주세요.', 404)
      const info = await inspectPdfText(buffer)
      if (info.pageCount > MAX_PDF_PAGES) throw new SourceUserError(`${info.pageCount}쪽 — PDF는 ${MAX_PDF_PAGES}쪽까지 요약할 수 있어요.`)
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
          const tiles = await tilesFromBuffers(pages.jpegs.length, async (i) => pages.jpegs[i], pdfTileLabel, crops)
          meta = { ...baseMeta, mode: 'image-pdf', imageCount: pages.jpegs.length, tileCount: tiles.length, chunked: tiles.length > CHUNK_THRESHOLD }
          if (meta.chunked) tilesForChunks = tiles
          else raw = await callSourceNote('image-pdf', tileBlocks(await reencodeIfTooLarge(tiles)), vocabForPrompt, usage)
        } else {
          console.error('[source-note] image-pdf-fallback', JSON.stringify({ file: file.id, reason: pages.reason, avgChars: info.avgChars }))
          meta = { ...baseMeta, mode: 'image-pdf-fallback' }
          raw = await callPdfDocument(file, buffer, vocabForPrompt, usage)
        }
      }
    } else {
      const tiles = await tilesFromBuffers(files.length, imageLoader(files), imageTileLabel(files.length), crops)
      meta = {
        kind, mode: 'images', fileNames: files.map((f) => f.file_name), pageCount: null,
        imageCount: files.length, tileCount: tiles.length, chunked: tiles.length > CHUNK_THRESHOLD,
      }
      if (meta.chunked) tilesForChunks = tiles
      else raw = await callSourceNote('images', tileBlocks(await reencodeIfTooLarge(tiles)), vocabForPrompt, usage)
    }

    // ── 분할 경로: 추출 1차수만 (남은 청크는 /extract, 종합은 /synthesize) ──
    let round: RoundResult | undefined
    let chunkTotal: number | undefined
    if (tilesForChunks) {
      const tiles = tilesForChunks
      chunkTotal = chunkCount(tiles.length)
      round = await advanceExtraction({ extracted: [], chunkTotal }, (i) => extractChunkAt(i, tiles, usage))
    }

    const costUsd = estimateCostUsd(usage)
    const usageDoc = { calls: usage, costUsd, crops: crops.length ? crops : undefined }
    console.error('[source-note] analyze', JSON.stringify({
      mode: meta.mode, tiles: meta.tileCount, chunked: meta.chunked,
      phase: round ? round.phase : 'done', chunks: round ? `${round.extracted.length}/${chunkTotal}` : undefined,
      costUsd, crops: crops.map((c) => [c.index, c.x0, c.x1, c.width, c.cropped]),
    }))

    const save = (stored: StoredAnalysis) => supabase
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

    if (round && chunkTotal !== undefined) {
      // 일부 청크가 실패해도 성공한 청크는 먼저 저장한다 — 재시도 시 남은 것만 다시
      const stored: StoredAnalysis = { phase: round.phase, meta, extracted: round.extracted, chunkTotal }
      const { data: saved, error: saveErr } = await save(stored)
      if (saveErr || !saved) throw new Error(`추출 결과 저장 실패: ${saveErr?.message}`)
      if (round.failure) throw round.failure
      return NextResponse.json(toPhaseResponse(saved.id, stored, false))
    }
    if (!raw) throw new Error('분석 결과가 비었어요')

    // ── 단일 호출 경로: 후처리 (프롬프트를 믿지 않는다) ──
    const { analysis, related } = await finalizeAnalysis(supabase, user.id, raw, vocab)
    const { data: saved, error: saveErr } = await save({ phase: 'done', result: analysis, related, meta })
    if (saveErr || !saved) throw new Error(`분석 결과 저장 실패: ${saveErr?.message}`)

    return NextResponse.json({
      phase: 'done',
      analysisId: saved.id,
      analysis,
      related,
      meta,
      cached: false,
      createdAt: saved.created_at,
    } satisfies AnalyzeResponse)
  } catch (e) {
    return sourceNoteErrorResponse(e, usage, 'analyze')
  }
}

/** 텍스트형(또는 폴백) PDF — URL document, URL fetch 실패 시 1회 base64 */
async function callPdfDocument(
  file: SourceFileRow,
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
