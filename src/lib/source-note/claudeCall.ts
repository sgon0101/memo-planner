/**
 * 소스 노트 Claude 호출 — 서버 전용
 *
 * 모든 호출의 토큰 사용량을 UsageEntry로 누적한다 (source_analyses.usage + 콘솔 기록).
 */

import type Anthropic from '@anthropic-ai/sdk'
import { anthropic, MODEL } from '@/lib/ai/claude'
import { sourceNotePrompt, sourceNoteUserText, type SourceNotePromptKind } from '@/lib/ai/prompts'
import type { ImageTile } from './tileImage'

export interface UsageEntry {
  step: string
  model: string
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
  ms: number
}

/** Sonnet 4.6 단가 (USD / 1M tokens) — 비용 표 계산용 */
const PRICE = { input: 3, output: 15, cacheWrite: 3.75, cacheRead: 0.3 }

export function estimateCostUsd(entries: UsageEntry[]): number {
  const c = entries.reduce((s, u) =>
    s
    + u.input_tokens * PRICE.input
    + u.output_tokens * PRICE.output
    + u.cache_creation_input_tokens * PRICE.cacheWrite
    + u.cache_read_input_tokens * PRICE.cacheRead, 0)
  return Math.round((c / 1_000_000) * 10000) / 10000
}

export function toUsageEntry(step: string, msg: Anthropic.Message, ms: number): UsageEntry {
  const u = msg.usage
  return {
    step,
    model: msg.model,
    input_tokens: u.input_tokens ?? 0,
    output_tokens: u.output_tokens ?? 0,
    cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
    cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
    ms,
  }
}

/** 타일 → [라벨 텍스트, 이미지] 블록 쌍 */
export function tileBlocks(tiles: ImageTile[]): Anthropic.ContentBlockParam[] {
  const blocks: Anthropic.ContentBlockParam[] = []
  for (const t of tiles) {
    blocks.push({ type: 'text', text: t.label })
    blocks.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: t.jpeg.toString('base64') } })
  }
  return blocks
}

export function messageText(msg: Anthropic.Message): string {
  return msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
}

/** 응답에서 JSON 객체 추출 — 코드펜스·앞뒤 설명이 섞여도 첫 { ~ 마지막 } */
export function parseJsonObject(text: string): Record<string, unknown> {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('JSON 객체를 찾지 못했어요')
  return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
}

export class TruncatedError extends Error {}

/**
 * Anthropic API 오류 → 사용자에게 보일 구체적 메시지 + HTTP 상태.
 * 크레딧 부족은 400(invalid_request_error)으로 오는데, 뭉뚱그려 "AI 분석에 실패했어요"로
 * 보이면 사용자는 재시도만 반복하게 된다 (실측 중 실제로 겪음) — 원인별로 구분한다.
 */
export function describeAnthropicError(e: { status?: number; message: string }): { message: string; status: number } {
  const text = e.message ?? ''
  if (/credit balance|purchase credits|billing/i.test(text)) {
    return { message: 'AI API 크레딧이 부족해요. 크레딧을 충전한 뒤 다시 시도해주세요.', status: 402 }
  }
  if (e.status === 401 || e.status === 403) {
    return { message: 'AI API 키 설정에 문제가 있어요. 관리자에게 알려주세요.', status: 502 }
  }
  if (e.status === 429 || e.status === 529 || e.status === 503) {
    return { message: 'AI 서버가 바빠요. 잠시 후 다시 시도해주세요.', status: 502 }
  }
  if (e.status === 413) {
    return { message: '보낼 자료가 너무 커요. 이미지 수를 줄여 다시 시도해주세요.', status: 413 }
  }
  return { message: 'AI 분석에 실패했어요. 잠시 후 다시 시도해주세요.', status: 502 }
}

/**
 * 요약 JSON 생성 호출 (4-2).
 * system은 kind별 고정 → cache_control ephemeral.
 */
export async function callSourceNote(
  kind: SourceNotePromptKind,
  inputBlocks: Anthropic.ContentBlockParam[],
  vocab: { wikis: string[]; tags: string[] },
  usage: UsageEntry[],
  step = 'summary',
): Promise<Record<string, unknown>> {
  const t0 = Date.now()
  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system: [{ type: 'text', text: sourceNotePrompt(kind), cache_control: { type: 'ephemeral' } }],
    messages: [{
      role: 'user',
      content: [...inputBlocks, { type: 'text', text: sourceNoteUserText(vocab) }],
    }],
  })
  const entry = toUsageEntry(step, msg, Date.now() - t0)
  usage.push(entry)
  // removeConsole이 dev에서도 log/warn을 지우므로 비용 기록은 error 채널로
  console.error('[source-note] usage', JSON.stringify(entry))

  if (msg.stop_reason === 'max_tokens') {
    throw new TruncatedError('요약 응답이 너무 길어 잘렸어요. 다시 분석해 주세요.')
  }
  return parseJsonObject(messageText(msg))
}
