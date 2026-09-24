/**
 * 긴 세트 분할 처리 (타일 > 40) — 서버 전용
 *
 * ① 타일을 최대 30개씩 청크로 (경계 타일 1개 공유)
 * ② 청크별 '추출' 호출(병렬 최대 3): 이미지 속 텍스트를 구조 그대로 마크다운으로 옮김
 * ③ 호출부가 추출문을 이어 붙여 '종합' 호출 (이미지 없이 텍스트만 → 저렴)
 *
 * 실패한 청크는 1회 재시도, 그래도 실패하면 전체를 에러로 — 부분 요약 금지
 * (누락을 모른 채 노트가 생기는 게 최악).
 *
 * 추출 출력은 JSON이 아니라 마크다운 본문으로 받는다 — 긴 전사문을 JSON 문자열로 받으면
 * 이스케이프 오류로 통째 파싱 실패할 위험이 커서. headings는 서버에서 `#` 줄로 뽑는다.
 */

import { anthropic, MODEL } from '@/lib/ai/claude'
import { SOURCE_CHUNK_EXTRACT_SYSTEM } from '@/lib/ai/prompts'
import { chunkRanges } from './computeTiles'
import { messageText, tileBlocks, toUsageEntry, type UsageEntry } from './claudeCall'
import { reencodeIfTooLarge, type ImageTile } from './tileImage'
import type { ChunkExtract } from './types'

const PARALLEL = 3
/**
 * 프롬프트 기준은 4000이지만, 30조각 전사문은 한국어 기준 4000토큰을 쉽게 넘어
 * 잘림(=조용한 누락)이 생긴다. 8000으로 두고 잘리면 에러로 처리한다.
 */
const EXTRACT_MAX_TOKENS = 8000

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
        { type: 'text', text: `위 ${safeTiles.length}개 조각의 텍스트를 순서대로 옮겨 적으세요.` },
      ],
    }],
  })
  const entry = toUsageEntry(`extract#${chunkIndex}`, msg, Date.now() - t0)
  usage.push(entry)
  // removeConsole이 dev에서도 log/warn을 지우므로 비용 기록은 error 채널로
  console.error('[source-note] usage', JSON.stringify(entry))

  if (msg.stop_reason === 'max_tokens') throw new Error(`구간 ${chunkIndex + 1} 추출이 잘렸어요`)
  const body = messageText(msg).trim()
  if (!body) throw new Error(`구간 ${chunkIndex + 1} 추출 결과가 비었어요`)
  const headings = body.split('\n').filter((l) => /^#{1,6}\s/.test(l)).map((l) => l.replace(/^#+\s*/, '').trim())
  return { chunkIndex, headings, body }
}

export async function extractChunks(tiles: ImageTile[], usage: UsageEntry[]): Promise<ChunkExtract[]> {
  const ranges = chunkRanges(tiles.length)
  const results: ChunkExtract[] = new Array(ranges.length)
  let cursor = 0
  let failure: Error | null = null

  async function worker() {
    for (;;) {
      if (failure) return
      const i = cursor++
      if (i >= ranges.length) return
      const [s, e] = ranges[i]
      try {
        results[i] = await extractOne(i, tiles.slice(s, e), usage)
      } catch (err) {
        console.warn(`[source-note] 구간 ${i + 1} 추출 실패 — 1회 재시도`, err instanceof Error ? err.message : err)
        try {
          results[i] = await extractOne(i, tiles.slice(s, e), usage)
        } catch (err2) {
          failure = err2 instanceof Error ? err2 : new Error(String(err2))
          return
        }
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(PARALLEL, ranges.length) }, worker))
  if (failure) throw new Error(`긴 이미지 일부를 읽지 못했어요 (${(failure as Error).message}). 다시 시도해 주세요.`)
  return results
}

/** 종합 호출용 텍스트 */
export function chunksToText(chunks: ChunkExtract[]): string {
  return chunks
    .slice()
    .sort((a, b) => a.chunkIndex - b.chunkIndex)
    .map((c) => `[구간 ${c.chunkIndex + 1}]\n${c.body}`)
    .join('\n\n')
}
