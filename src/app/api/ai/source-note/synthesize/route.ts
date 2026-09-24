/**
 * POST /api/ai/source-note/synthesize — 분할 경로 ② 종합
 *
 * 입력: { analysisId }
 *
 * /analyze(①)가 청크 추출문을 source_analyses에 phase 'extracted'로 캐시해 두면, 이 요청이
 * **캐시된 extracted만** 읽어 종합한다 (이미지·추출 재호출 없음). 한 요청에 추출+종합을 다 하면
 * 실측 268초로 Vercel 300초 한도에 근접해 두 요청으로 나눴다.
 *
 * - phase 'extracted'일 때만 AI를 호출한다 → 한도 차감은 ①에서 1회, 여기는 추가 차감 없이도
 *   반복 호출로 비용이 새지 않는다 (종합이 끝나면 phase 'done'이 되어 다시 부르면 캐시 반환).
 * - 종합이 실패하면 phase는 'extracted'로 남아 재시도 시 ②만 다시 한다.
 */

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import { synthesizeFromChunks } from '@/lib/source-note/chunkedExtract'
import { TruncatedError, describeAnthropicError, estimateCostUsd, type UsageEntry } from '@/lib/source-note/claudeCall'
import { buildVocab, finalizeAnalysis } from '@/lib/source-note/postprocess'
import type { AnalyzeResponse, StoredAnalysis } from '@/lib/source-note/types'

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
      .select('id, analysis, usage, created_at')
      .eq('id', analysisId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (rowErr) throw new Error(rowErr.message)
    if (!row) return NextResponse.json({ error: '분석 결과를 찾을 수 없어요. 다시 분석해주세요.' }, { status: 404 })

    const stored = row.analysis as StoredAnalysis

    // 이미 종합이 끝난 행 — 캐시 그대로 (AI 호출 없음)
    if (stored.phase !== 'extracted' && stored.result) {
      return NextResponse.json({
        phase: 'done', analysisId: row.id, analysis: stored.result, related: stored.related ?? [],
        meta: stored.meta, cached: true, createdAt: row.created_at,
      } satisfies AnalyzeResponse)
    }
    if (!stored.extracted?.length) {
      return NextResponse.json({ error: '종합할 추출 결과가 없어요. 다시 분석해주세요.' }, { status: 409 })
    }

    const vocab = await buildVocab(supabase, user.id)
    const raw = await synthesizeFromChunks(stored.extracted, { wikis: vocab.wikiList, tags: vocab.tagList }, usage, 'synthesis')
    const { analysis, related } = await finalizeAnalysis(supabase, user.id, raw, vocab)

    // 사용량은 ①의 기록에 이어 붙인다 (분석 1건의 전체 비용이 한 행에 남도록)
    const prev = (row.usage ?? {}) as { calls?: UsageEntry[]; crops?: unknown }
    const calls = [...(prev.calls ?? []), ...usage]
    const usageDoc = { ...prev, calls, costUsd: estimateCostUsd(calls) }
    console.error('[source-note] synthesized', JSON.stringify({ analysisId, costUsd: estimateCostUsd(usage), totalUsd: usageDoc.costUsd }))

    const createdAt = new Date().toISOString()
    const { error: saveErr } = await supabase
      .from('source_analyses')
      .update({
        analysis: { ...stored, phase: 'done', result: analysis, related } satisfies StoredAnalysis,
        usage: usageDoc,
        created_at: createdAt,
      })
      .eq('id', row.id)
    if (saveErr) throw new Error(`분석 결과 저장 실패: ${saveErr.message}`)

    return NextResponse.json({
      phase: 'done', analysisId: row.id, analysis, related, meta: stored.meta, cached: false, createdAt,
    } satisfies AnalyzeResponse)
  } catch (e) {
    if (usage.length) console.error('[source-note] failed usage', JSON.stringify({ costUsd: estimateCostUsd(usage), calls: usage }))
    if (e instanceof TruncatedError) return NextResponse.json({ error: e.message }, { status: 502 })
    if (e instanceof Anthropic.APIError) {
      console.error('[source-note] anthropic', e.status, e.message)
      const { message, status } = describeAnthropicError(e)
      return NextResponse.json({ error: message }, { status })
    }
    console.error('[source-note] synthesize 실패:', e)
    return NextResponse.json({ error: '내용 종합에 실패했어요. 다시 시도해주세요.' }, { status: 500 })
  }
}
