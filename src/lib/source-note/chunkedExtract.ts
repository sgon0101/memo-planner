/**
 * 긴 세트 분할 처리 (타일 > 40) — 서버 전용
 *
 * ① 타일을 최대 15개씩 청크로 (경계 타일 1개 공유)
 * ② 청크별 '추출' 호출(병렬 최대 5): 이미지 속 내용을 구조 그대로 **압축 전사**
 * ③ 호출부가 추출문을 이어 붙여 '종합' 호출 (이미지 없이 텍스트만 → 저렴)
 *
 * 실패하면 전체를 에러로 — 부분 요약 금지 (누락을 모른 채 노트가 생기는 게 최악).
 * 재시도는 네트워크·API 오류만 1회. 출력 한도 잘림은 같은 입력이면 또 잘리므로
 * 재시도하지 않는다 (E2E에서 잘림 재시도가 비용만 두 배로 만든 것을 확인).
 *
 * 설계안(30조각·충실 전사·4000토큰)은 글자가 빽빽한 캡처에서 30조각 전사문이 2만 자를
 * 넘어 출력 한도에서 잘렸다 → 15조각 + 압축 전사(요점·예시·수치는 모두, 문장은 짧게)로 조정.
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

/** 최대 150조각 = 11청크 → 3라운드 안에 끝나도록 */
const PARALLEL = 5
const EXTRACT_MAX_TOKENS = 6000

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
        { type: 'text', text: `위 ${safeTiles.length}개 조각의 내용을 순서대로 압축 전사하세요.` },
      ],
    }],
  })
  const entry = toUsageEntry(`extract#${chunkIndex}`, msg, Date.now() - t0)
  usage.push(entry)
  // removeConsole이 dev에서도 log/warn을 지우므로 비용 기록은 error 채널로
  console.error('[source-note] usage', JSON.stringify(entry))

  if (msg.stop_reason === 'max_tokens') throw new ChunkTruncatedError(`구간 ${chunkIndex + 1} 추출이 너무 길어 잘렸어요`)
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
        if (err instanceof ChunkTruncatedError) { failure = err; return }
        console.error(`[source-note] 구간 ${i + 1} 추출 실패 — 1회 재시도`, err instanceof Error ? err.message : err)
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
