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
 * - AI 호출 전에 phase를 'synthesizing'으로 **조건부 선점**한다 (`analysis->>phase` 일치 시에만 update).
 *   동시 요청 두 개가 와도 하나만 AI를 부르고, 나머지는 캐시(이미 끝났으면) 또는 409를 받는다.
 *   함수가 시간 초과로 죽어 선점이 남으면 SYNTH_CLAIM_TTL_MS 뒤 다음 요청이 다시 가져간다.
 * - 종합이 실패하면 phase를 'extracted'로 되돌려 재시도 시 ②만 다시 한다.
 * - 쓰기는 서버 전용(서비스 롤) + `.eq('user_id', user.id)`, 읽기는 사용자 세션(RLS).
 */

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { synthesizeFromChunks } from '@/lib/source-note/chunkedExtract'
import { TruncatedError, describeAnthropicError, estimateCostUsd, type UsageEntry } from '@/lib/source-note/claudeCall'
import { buildVocab, finalizeAnalysis } from '@/lib/source-note/postprocess'
import type { AnalyzeResponse, StoredAnalysis } from '@/lib/source-note/types'

export const runtime = 'nodejs'
export const maxDuration = 300

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** maxDuration(300초) + 여유 — 이보다 오래된 'synthesizing' 선점은 죽은 요청으로 본다 */
const SYNTH_CLAIM_TTL_MS = 6 * 60 * 1000

const BUSY_MESSAGE = '이미 내용을 종합하고 있어요. 잠시 후 다시 확인해주세요.'

interface Row { id: string; analysis: unknown; usage: unknown; created_at: string }

function isFinished(stored: StoredAnalysis): boolean {
  return stored.phase !== 'extracted' && stored.phase !== 'synthesizing' && !!stored.result
}

function isClaimFresh(stored: StoredAnalysis): boolean {
  if (stored.phase !== 'synthesizing' || !stored.synthStartedAt) return false
  return Date.now() - new Date(stored.synthStartedAt).getTime() < SYNTH_CLAIM_TTL_MS
}

function cachedResponse(row: Row, stored: StoredAnalysis) {
  return NextResponse.json({
    phase: 'done', analysisId: row.id, analysis: stored.result!, related: stored.related ?? [],
    meta: stored.meta, cached: true, createdAt: row.created_at,
  } satisfies AnalyzeResponse)
}

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

  const readRow = async (): Promise<Row | null> => {
    const { data, error } = await supabase
      .from('source_analyses')
      .select('id, analysis, usage, created_at')
      .eq('id', analysisId)
      .eq('user_id', user.id)
      .maybeSingle()
    if (error) throw new Error(error.message)
    return data as Row | null
  }
  /** 선점·저장 경합에서 졌을 때 — 이미 끝났으면 캐시, 아니면 다른 요청이 진행 중 */
  const afterLostRace = async () => {
    const latest = await readRow()
    const latestStored = latest?.analysis as StoredAnalysis | undefined
    if (latest && latestStored && isFinished(latestStored)) return cachedResponse(latest, latestStored)
    return NextResponse.json({ error: BUSY_MESSAGE }, { status: 409 })
  }

  const admin = createAdminClient()
  const usage: UsageEntry[] = []
  let claimedAt: string | null = null
  let stored: StoredAnalysis | null = null
  try {
    const row = await readRow()
    if (!row) return NextResponse.json({ error: '분석 결과를 찾을 수 없어요. 다시 분석해주세요.' }, { status: 404 })
    stored = row.analysis as StoredAnalysis

    // 이미 종합이 끝난 행 — 캐시 그대로 (AI 호출 없음)
    if (isFinished(stored)) return cachedResponse(row, stored)
    if (!stored.extracted?.length) {
      return NextResponse.json({ error: '종합할 추출 결과가 없어요. 다시 분석해주세요.' }, { status: 409 })
    }
    if (isClaimFresh(stored)) return NextResponse.json({ error: BUSY_MESSAGE }, { status: 409 })

    // ── 선점: 읽은 상태 그대로일 때만 'synthesizing'으로 (동시 요청 중 하나만 통과) ──
    claimedAt = new Date().toISOString()
    let claim = admin
      .from('source_analyses')
      .update({ analysis: { ...stored, phase: 'synthesizing', synthStartedAt: claimedAt } satisfies StoredAnalysis })
      .eq('id', row.id)
      .eq('user_id', user.id)
    claim = stored.phase
      ? claim.eq('analysis->>phase', stored.phase)
      : claim.is('analysis->>phase', null)
    if (stored.phase === 'synthesizing') claim = claim.eq('analysis->>synthStartedAt', stored.synthStartedAt ?? '')
    const { data: claimed, error: claimErr } = await claim.select('id')
    if (claimErr) throw new Error(`종합 선점 실패: ${claimErr.message}`)
    if (!claimed?.length) {
      claimedAt = null
      return afterLostRace()
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
    // 내 선점이 그대로일 때만 저장 (그사이 [다시 분석]·만료 재선점이 있었다면 덮어쓰지 않는다)
    const { data: saved, error: saveErr } = await admin
      .from('source_analyses')
      .update({
        analysis: { ...stored, phase: 'done', result: analysis, related, synthStartedAt: undefined } satisfies StoredAnalysis,
        usage: usageDoc,
        created_at: createdAt,
      })
      .eq('id', row.id)
      .eq('user_id', user.id)
      .eq('analysis->>synthStartedAt', claimedAt)
      .select('id')
    if (saveErr) throw new Error(`분석 결과 저장 실패: ${saveErr.message}`)
    claimedAt = null
    if (!saved?.length) return afterLostRace()

    return NextResponse.json({
      phase: 'done', analysisId: row.id, analysis, related, meta: stored.meta, cached: false, createdAt,
    } satisfies AnalyzeResponse)
  } catch (e) {
    // 선점한 채 실패 — 'extracted'로 되돌려 재시도 가능하게 (내 선점일 때만)
    if (claimedAt && stored) {
      const { error: revertErr } = await admin
        .from('source_analyses')
        .update({ analysis: { ...stored, phase: 'extracted', synthStartedAt: undefined } satisfies StoredAnalysis })
        .eq('id', analysisId)
        .eq('user_id', user.id)
        .eq('analysis->>synthStartedAt', claimedAt)
      if (revertErr) console.error('[source-note] synthesize 선점 해제 실패:', revertErr.message)
    }
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
