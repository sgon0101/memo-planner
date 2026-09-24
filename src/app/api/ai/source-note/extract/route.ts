/**
 * POST /api/ai/source-note/extract — 분할 경로 추출 이어 받기 (요청 하나 = 병렬 1차수)
 *
 * 입력: { analysisId }
 *
 * /analyze가 첫 차수(최대 5청크)를 추출해 phase 'extracting'으로 캐시하면, 클라이언트가 남은
 * 청크가 없을 때까지 이 요청을 반복한다. 청크 5개를 한 요청에서 여러 차수로 돌리면 54조각 ≈ 260초,
 * 150조각 ≈ 390초가 되어 Vercel 300초 한도를 넘기 때문.
 *
 * - 타일은 원본에서 다시 만든다(가공물 저장 금지 원칙). 결정적 계산이라 청크 경계가 같다 —
 *   meta.tileCount와 다르면 중단.
 * - 남은 청크 중 최대 5개만 추출해 청크 단위로 누적 저장. 일부가 실패해도 성공분은 먼저 저장하고
 *   오류를 돌려준다 → 재시도하면 남은 것만 다시.
 * - phase 'extracting'일 때만 AI를 호출 → 한도 차감은 /analyze 첫 요청 1회로 묶인다.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { chunkCount, extractChunkAt } from '@/lib/source-note/chunkedExtract'
import { estimateCostUsd, type UsageEntry } from '@/lib/source-note/claudeCall'
import { advanceExtraction, toPhaseResponse } from '@/lib/source-note/extractRounds'
import { sourceNoteErrorResponse } from '@/lib/source-note/routeErrors'
import { SourceUserError, loadSourceTiles, type SourceFileRow } from '@/lib/source-note/sourceTiles'
import type { StoredAnalysis } from '@/lib/source-note/types'

export const runtime = 'nodejs'
export const maxDuration = 300

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })

  let body: { analysisId?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: '잘못된 요청 형식입니다.' }, { status: 400 })
  }
  const analysisId = typeof body.analysisId === 'string' && UUID_RE.test(body.analysisId) ? body.analysisId : null
  if (!analysisId) return NextResponse.json({ error: '분석 정보가 올바르지 않습니다.' }, { status: 400 })

  const usage: UsageEntry[] = []
  try {
    const { data: row, error: rowErr } = await supabase
      .from('source_analyses')
      .select('id, analysis, usage, file_ids')
      .eq('id', analysisId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (rowErr) throw new Error(rowErr.message)
    if (!row) throw new SourceUserError('분석 결과를 찾을 수 없어요. 다시 분석해주세요.', 404)

    const stored = row.analysis as StoredAnalysis
    // 추출이 이미 끝났으면 그대로 (다음은 /synthesize)
    if (stored.phase !== 'extracting') return NextResponse.json(toPhaseResponse(row.id, stored, true))

    const mode = stored.meta.mode
    if ((mode !== 'image-pdf' && mode !== 'images') || !stored.chunkTotal) {
      throw new SourceUserError('이어서 읽을 수 없는 분석이에요. 다시 분석해주세요.', 409)
    }

    // 원본 → 타일 (첫 요청과 같은 결정적 계산)
    const fileIds = (row.file_ids as string[]) ?? []
    const { data: rowsData, error: filesErr } = await supabase
      .from('uploaded_files')
      .select('id, r2_key, public_url, file_name, mime_type, content_hash, compressed_size, image_width, image_height, page_count, is_source')
      .eq('user_id', user.id)
      .in('id', fileIds)
    if (filesErr) throw new Error(`파일 조회 실패: ${filesErr.message}`)
    const byId = new Map(((rowsData ?? []) as SourceFileRow[]).map((r) => [r.id, r]))
    const files = fileIds.map((id) => byId.get(id)).filter((r): r is SourceFileRow => !!r)
    if (files.length !== fileIds.length) throw new SourceUserError('원본 파일을 찾을 수 없어요. 다시 올려주세요.', 404)

    const tiles = await loadSourceTiles(files, mode)
    if (tiles.length !== stored.meta.tileCount || chunkCount(tiles.length) !== stored.chunkTotal) {
      throw new SourceUserError('원본에서 만든 조각이 처음과 달라요. 다시 분석해주세요.', 409)
    }

    const round = await advanceExtraction(
      { extracted: stored.extracted ?? [], chunkTotal: stored.chunkTotal },
      (i) => extractChunkAt(i, tiles, usage),
    )

    // 사용량은 앞 요청들의 기록에 이어 붙인다 (분석 1건의 전체 비용이 한 행에 남도록)
    const prev = (row.usage ?? {}) as { calls?: UsageEntry[] }
    const calls = [...(prev.calls ?? []), ...usage]
    const next: StoredAnalysis = { ...stored, phase: round.phase, extracted: round.extracted }
    const { error: saveErr } = await supabase
      .from('source_analyses')
      .update({ analysis: next, usage: { ...prev, calls, costUsd: estimateCostUsd(calls) } })
      .eq('id', row.id)
    if (saveErr) throw new Error(`추출 결과 저장 실패: ${saveErr.message}`)
    console.error('[source-note] extract', JSON.stringify({
      analysisId, ran: round.ran, chunks: `${round.extracted.length}/${stored.chunkTotal}`, costUsd: estimateCostUsd(usage),
    }))

    // 성공분은 저장됐다 — 실패는 재시도하면 남은 청크만 다시
    if (round.failure) throw round.failure
    return NextResponse.json(toPhaseResponse(row.id, next, false))
  } catch (e) {
    return sourceNoteErrorResponse(e, usage, 'extract')
  }
}
