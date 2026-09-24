/**
 * 긴 세트 분할 처리 (타일 > 40) — 서버 전용
 *
 * ① 타일을 최대 10개씩 청크로 (경계 타일 1개 공유)
 * ② 청크별 '추출' 호출: 이미지 속 내용을 구조 그대로 **압축 전사**
 *    출력 한도에서 잘리면 그 청크만 반으로 나눠(경계 1조각 공유) 다시 추출해 합친다
 *    요청 하나 = 병렬 1차수(최대 5청크) — 차수 관리·누적 캐시는 extractRounds.ts, 이어 받기는 /extract
 * ③ 추출문을 이어 붙여 '종합' 호출 (이미지 없이 텍스트만 → 저렴, /synthesize)
 *
 * 인용: 압축 본문에서 뽑으면 원문이 아니게 되므로, 추출 단계에서 따옴표·강조·결론 문장을
 * 원문 그대로 인용 후보로 따로 받고(QUOTE_MARKER 아래), 종합은 후보 번호로만 고르게 한 뒤
 * 서버가 번호를 원문으로 치환한다 (모델이 문장을 고쳐 써도 저장되는 건 항상 원문).
 *
 * 실패하면 전체를 에러로 — 부분 요약 금지 (누락을 모른 채 노트가 생기는 게 최악).
 * 재시도는 네트워크·API 오류만 1회. 출력 한도 잘림은 같은 입력이면 또 잘리므로 그대로
 * 재시도하지 않고 반으로 나눈다 (반쪽도 잘리면 실패).
 *
 * 설계안(30조각·충실 전사·4000토큰)은 글자가 빽빽한 캡처에서 30조각 전사문이 2만 자를
 * 넘어 출력 한도에서 잘렸다 → 압축 전사(요점·예시·수치는 모두, 문장은 짧게)로 조정.
 * 15조각·6000토큰도 실제 이소정 캡처 PDF(63분 분량 기사)에서 잘려 → 10조각·8000토큰 + 반분할.
 *
 * 추출 출력은 JSON이 아니라 마크다운 본문으로 받는다 — 긴 전사문을 JSON 문자열로 받으면
 * 이스케이프 오류로 통째 파싱 실패할 위험이 커서. headings는 서버에서 `#` 줄로 뽑는다.
 */

import Anthropic from '@anthropic-ai/sdk'
import { anthropic, MODEL } from '@/lib/ai/claude'
import { QUOTE_MARKER, SOURCE_CHUNK_EXTRACT_SYSTEM } from '@/lib/ai/prompts'
import { chunkRanges } from './computeTiles'
import { callSourceNote, messageText, tileBlocks, toUsageEntry, type UsageEntry } from './claudeCall'
import { reencodeIfTooLarge, type ImageTile } from './tileImage'
import type { ChunkExtract, QuoteCandidate } from './types'

const EXTRACT_MAX_TOKENS = 8000

class ChunkTruncatedError extends Error {}

async function extractOne(chunkIndex: number, tiles: ImageTile[], usage: UsageEntry[]): Promise<ChunkExtract> {
  const safeTiles = await reencodeIfTooLarge(tiles)
  const t0 = Date.now()
  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: EXTRACT_MAX_TOKENS,
    system: [{ type: 'text', text: SOURCE_CHUNK_EXTRACT_SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{
      role: 'user',
      content: [
        ...tileBlocks(safeTiles),
        {
          type: 'text',
          // 형식 지시를 마지막 턴에도 반복 — system에만 두면 인용 후보 구획을 빼먹는 경우가 실측에서 나왔다
          text: [
            `위 ${safeTiles.length}개 조각의 내용을 순서대로 압축 전사하세요.`,
            `출력 형식: ① 압축 본문 → ② "${QUOTE_MARKER}" 한 줄 → ③ 인용 후보 목록 \`- "원문 그대로" (p.N · 조각 M)\`.`,
            '하이라이트·굵은 글씨·인용 박스 문장은 반드시 ③에 넣고, 위치는 그 문장 바로 위 [라벨] 하나만.',
          ].join('\n'),
        },
      ],
    }],
  })
  const entry = toUsageEntry(`extract#${chunkIndex}`, msg, Date.now() - t0)
  usage.push(entry)
  // removeConsole이 dev에서도 log/warn을 지우므로 비용 기록은 error 채널로
  console.error('[source-note] usage', JSON.stringify(entry))

  if (msg.stop_reason === 'max_tokens') throw new ChunkTruncatedError(`구간 ${chunkIndex + 1} 추출이 너무 길어 잘렸어요`)
  const { body, quoteCandidates } = parseChunkOutput(messageText(msg))
  if (!body) throw new Error(`구간 ${chunkIndex + 1} 추출 결과가 비었어요`)
  const headings = body.split('\n').filter((l) => /^#{1,6}\s/.test(l)).map((l) => l.replace(/^#+\s*/, '').trim())
  return { chunkIndex, headings, body, quoteCandidates }
}

const MAX_CANDIDATES_PER_CHUNK = 10
/** `- "문장" (이미지 2 · 조각 3)` — 따옴표는 ASCII·곡선 모두 허용, 위치 괄호는 선택 */
const CANDIDATE_LINE = /^\s*[-*•]\s*["“”](.+)["“”]\s*(?:\(([^()]*)\))?\s*$/

/** 추출 응답 → 압축 본문 + 원문 인용 후보 (순수 함수) */
export function parseChunkOutput(raw: string): { body: string; quoteCandidates: QuoteCandidate[] } {
  const idx = raw.indexOf(QUOTE_MARKER)
  if (idx < 0) {
    const body = raw.trim()
    return { body, quoteCandidates: harvestInlineQuotes(body) }
  }
  const body = raw.slice(0, idx).trim()
  const quoteCandidates: QuoteCandidate[] = []
  for (const line of raw.slice(idx + QUOTE_MARKER.length).split('\n')) {
    const m = line.match(CANDIDATE_LINE)
    if (!m) continue
    const text = m[1].trim()
    if (!text) continue
    quoteCandidates.push(m[2]?.trim() ? { text, loc: m[2].trim() } : { text })
    if (quoteCandidates.length >= MAX_CANDIDATES_PER_CHUNK) break
  }
  return { body, quoteCandidates: quoteCandidates.length ? quoteCandidates : harvestInlineQuotes(body) }
}

/** `> "문장" (p.3 · 조각 1)` 인용 블록 — 위치 괄호·"— 화자" 꼬리는 선택 */
const INLINE_QUOTE = /^>\s*["“](.+)["”]\s*(?:\(([^()]*)\))?\s*(?:[—–-].*)?$/
/** 위치 라벨: (p.4 · 조각 2) / (이미지 2 · 조각 3) / (p.9) */
const LOC_LABEL = /\(((?:p\.\d+|이미지 \d+)[^()]*)\)/
const IS_LOC = /^(?:p\.\d+|이미지 \d+)/

/**
 * 폴백: 모델이 인용 후보 구획을 빼먹고 인용할 문장을 본문 안 `> "…"` 블록으로만 넣는 경우가
 * 실측에서 나왔다(이소정 캡처 PDF 5구간 전부). 따옴표 인용 블록은 원문 발언이므로 후보로 회수한다.
 *
 * 위치: 인용 줄 끝의 조각 라벨이 있으면 그것을 쓴다. 없을 때만 직전 라벨(보통 소제목의 라벨)을
 * 물려받는다 — 이 물려받기가 "p.2 → 실제 p.3"처럼 한 쪽씩 밀리던 원인이었다(소제목 구간이
 * 다음 쪽까지 이어지므로). 그래서 추출 프롬프트가 인용마다 자기 라벨을 붙이게 한다.
 */
export function harvestInlineQuotes(body: string): QuoteCandidate[] {
  const out: QuoteCandidate[] = []
  let carried: string | undefined
  for (const line of body.split('\n')) {
    const m = line.trim().match(INLINE_QUOTE)
    if (m) {
      const text = m[1].trim()
      const own = m[2]?.trim()
      const loc = own && IS_LOC.test(own) ? own : carried
      // 인용 줄의 자기 라벨이 가장 최근 위치 — 다음 라벨 없는 인용은 이것을 물려받는다
      if (own && IS_LOC.test(own)) carried = own
      if (text) out.push(loc ? { text, loc } : { text })
      if (out.length >= MAX_CANDIDATES_PER_CHUNK) break
      continue
    }
    const label = line.match(LOC_LABEL)
    if (label) carried = label[1].trim()
  }
  return out
}

/** 비교용 정규화 — 공백·따옴표·문장부호 차이만 무시 (글자 자체는 비교, 저장은 항상 후보 원문) */
const quoteKey = (s: string) => s.normalize('NFC').replace(/[\s"“”'‘’.,!?…~·]/g, '')

/**
 * 모든 청크의 후보를 Q1, Q2… 로 번호 매김. 청크 경계는 조각 1개가 겹치므로
 * 같은 문장이 두 청크에 나오면 한 번만 남긴다.
 */
export function collectQuoteCandidates(chunks: ChunkExtract[]): (QuoteCandidate & { id: string })[] {
  const seen = new Set<string>()
  const out: (QuoteCandidate & { id: string })[] = []
  for (const c of chunks.slice().sort((a, b) => a.chunkIndex - b.chunkIndex)) {
    // 후보가 비어 저장된 추출문(구획 누락)은 본문 인용 블록에서 회수
    const list = c.quoteCandidates?.length ? c.quoteCandidates : harvestInlineQuotes(c.body)
    for (const q of list) {
      const k = quoteKey(q.text)
      if (!k || seen.has(k)) continue
      seen.add(k)
      out.push({ id: `Q${out.length + 1}`, ...q })
    }
  }
  return out
}

/**
 * 종합 응답의 quotes를 후보 원문으로 치환 — 모델이 문장을 고쳐 써도 저장되는 건 항상 추출 원문.
 * `{id:"Q3"}` / `"Q3"` / 후보와 글자가 같은 `{text}`만 인정하고 나머지(지어낸 문장)는 버린다.
 */
export function resolveChunkQuotes(
  raw: Record<string, unknown>,
  candidates: (QuoteCandidate & { id: string })[],
): Record<string, unknown> {
  const byId = new Map(candidates.map((c) => [c.id.toUpperCase(), c]))
  const byKey = new Map(candidates.map((c) => [quoteKey(c.text), c]))
  const picked: QuoteCandidate[] = []
  const used = new Set<string>()
  for (const q of Array.isArray(raw.quotes) ? raw.quotes : []) {
    const obj = (typeof q === 'object' && q ? q : {}) as Record<string, unknown>
    const id = typeof q === 'string' ? q : typeof obj.id === 'string' ? obj.id : ''
    const hit = byId.get(id.trim().toUpperCase())
      ?? (typeof obj.text === 'string' ? byKey.get(quoteKey(obj.text)) : undefined)
    if (!hit || used.has(hit.id)) continue
    used.add(hit.id)
    picked.push(hit.loc ? { text: hit.text, loc: hit.loc } : { text: hit.text })
  }
  return { ...raw, quotes: picked }
}

/** 청크 추출문 → 종합 호출 → 인용을 후보 원문으로 치환 */
export async function synthesizeFromChunks(
  chunks: ChunkExtract[],
  vocab: { wikis: string[]; tags: string[] },
  usage: UsageEntry[],
  step: string,
): Promise<Record<string, unknown>> {
  const candidates = collectQuoteCandidates(chunks)
  const raw = await callSourceNote('chunks', [{ type: 'text', text: chunksToText(chunks, candidates) }], vocab, usage, step)
  return resolveChunkQuotes(raw, candidates)
}

/** 잘리면 반으로 나눠(경계 1조각 공유) 두 번 추출해 하나의 청크로 합친다 */
async function extractWithSplit(chunkIndex: number, tiles: ImageTile[], usage: UsageEntry[]): Promise<ChunkExtract> {
  try {
    return await extractOne(chunkIndex, tiles, usage)
  } catch (err) {
    if (!(err instanceof ChunkTruncatedError) || tiles.length < 4) throw err
    console.error(`[source-note] 구간 ${chunkIndex + 1} 잘림 — 반으로 나눠 재추출 (${tiles.length}조각)`)
    const mid = Math.floor(tiles.length / 2)
    const [a, b] = await Promise.all([
      extractOne(chunkIndex, tiles.slice(0, mid + 1), usage),
      extractOne(chunkIndex, tiles.slice(mid), usage),
    ])
    return {
      chunkIndex,
      headings: [...a.headings, ...b.headings],
      body: `${a.body}\n\n${b.body}`,
      quoteCandidates: [...(a.quoteCandidates ?? []), ...(b.quoteCandidates ?? [])],
    }
  }
}

/** 분할 청크 수 (경계 1조각 공유) */
export function chunkCount(tileCount: number): number {
  return chunkRanges(tileCount).length
}

/**
 * 청크 하나 추출 — 잘리면 반분할, 그 외 오류는 1회 재시도.
 * 여러 청크의 병렬·차수 관리는 extractRounds.advanceExtraction이 한다 (요청당 1차수).
 * API 오류(크레딧 부족·인증 등)는 감싸지 않고 그대로 올려 route가 원인별 메시지를 고르게 한다.
 */
export async function extractChunkAt(chunkIndex: number, tiles: ImageTile[], usage: UsageEntry[]): Promise<ChunkExtract> {
  const range = chunkRanges(tiles.length)[chunkIndex]
  if (!range) throw new Error(`구간 ${chunkIndex + 1}이 범위를 벗어났어요`)
  const slice = tiles.slice(range[0], range[1])
  try {
    return await extractWithSplit(chunkIndex, slice, usage)
  } catch (err) {
    if (err instanceof Anthropic.APIError && !(err.status === 429 || err.status === 529 || (err.status ?? 0) >= 500)) throw err
    if (err instanceof ChunkTruncatedError) {
      throw new Error(`긴 이미지 일부를 읽지 못했어요 (${err.message}). 다시 시도해 주세요.`)
    }
    console.error(`[source-note] 구간 ${chunkIndex + 1} 추출 실패 — 1회 재시도`, err instanceof Error ? err.message : err)
    try {
      return await extractOne(chunkIndex, slice, usage)
    } catch (err2) {
      if (err2 instanceof Anthropic.APIError) throw err2
      throw new Error(`긴 이미지 일부를 읽지 못했어요 (${err2 instanceof Error ? err2.message : err2}). 다시 시도해 주세요.`)
    }
  }
}

/** 종합 호출용 텍스트 — 압축 본문 + 끝에 번호 붙인 원문 인용 후보 */
export function chunksToText(chunks: ChunkExtract[], candidates = collectQuoteCandidates(chunks)): string {
  const body = chunks
    .slice()
    .sort((a, b) => a.chunkIndex - b.chunkIndex)
    .map((c) => `[구간 ${c.chunkIndex + 1}]\n${c.body}`)
    .join('\n\n')
  const list = candidates.length
    ? candidates.map((q) => `[${q.id}] "${q.text}"${q.loc ? ` (${q.loc})` : ''}`).join('\n')
    : '(없음)'
  return `${body}\n\n[인용 후보 — 원문 그대로, quotes는 여기서 번호로만 고르세요]\n${list}`
}
