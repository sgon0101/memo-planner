/**
 * 소스 노트 라우트 공통 오류 응답 (/analyze · /extract · /synthesize)
 */

import { NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { TruncatedError, describeAnthropicError, estimateCostUsd, type UsageEntry } from './claudeCall'
import { SourceUserError } from './sourceTiles'

export function sourceNoteErrorResponse(e: unknown, usage: UsageEntry[], step: string, fallback = '분석에 실패했어요. 다시 시도해주세요.'): Response {
  // 실패해도 이미 쓴 토큰은 기록한다 (removeConsole이 log/warn을 지우므로 error 채널)
  if (usage.length) console.error('[source-note] failed usage', JSON.stringify({ step, costUsd: estimateCostUsd(usage), calls: usage }))
  if (e instanceof SourceUserError) return NextResponse.json({ error: e.message }, { status: e.status })
  if (e instanceof TruncatedError) return NextResponse.json({ error: e.message }, { status: 502 })
  if (e instanceof Anthropic.APIError) {
    console.error('[source-note] anthropic', e.status, e.message)
    const { message, status } = describeAnthropicError(e)
    return NextResponse.json({ error: message }, { status })
  }
  console.error(`[source-note] ${step} 실패:`, e)
  const msg = e instanceof Error && /읽지 못했어요|잘렸어요/.test(e.message) ? e.message : fallback
  return NextResponse.json({ error: msg }, { status: 500 })
}
