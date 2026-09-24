/**
 * 분할 추출 차수 관리 — 순수 로직 (서버 라우트·흐름 테스트 공용)
 *
 * 추출도 요청 하나 = 병렬 1차수(최대 CHUNKS_PER_REQUEST 청크)로 나눈다.
 * 청크가 5개를 넘으면 한 요청 안에서 차수가 늘어 54조각(6청크) ≈ 260초, 150조각 ≈ 390초가 되어
 * Vercel 300초 한도를 넘기 때문. 청크 결과는 source_analyses에 청크 단위로 누적 캐시하고,
 * 클라이언트가 남은 청크가 없을 때까지 이어서 호출한다. 실패해도 완료된 청크는 재사용.
 */

import type { ChunkExtract, ExtractPhaseResponse, StoredAnalysis } from './types'

/** 요청 하나에서 병렬로 추출할 최대 청크 수 (= 병렬 1차수) */
export const CHUNKS_PER_REQUEST = 5

export interface ExtractionProgress {
  /** 완료된 청크 수 */
  doneChunks: number
  totalChunks: number
  /** 다음에 실행할(또는 실행 중인) 차수, 1부터. 완료면 rounds */
  round: number
  /** 전체 차수 = ceil(totalChunks / CHUNKS_PER_REQUEST) */
  rounds: number
  complete: boolean
}

export function extractionProgress(doneChunks: number, totalChunks: number, per = CHUNKS_PER_REQUEST): ExtractionProgress {
  const rounds = Math.max(1, Math.ceil(totalChunks / per))
  const complete = doneChunks >= totalChunks
  const round = complete ? rounds : Math.min(rounds, Math.floor(doneChunks / per) + 1)
  return { doneChunks, totalChunks, round, rounds, complete }
}

/** 아직 안 된 청크 중 번호가 작은 것부터 최대 max개 */
export function nextRoundIndexes(totalChunks: number, done: Iterable<number>, max = CHUNKS_PER_REQUEST): number[] {
  const doneSet = new Set(done)
  const out: number[] = []
  for (let i = 0; i < totalChunks && out.length < max; i++) if (!doneSet.has(i)) out.push(i)
  return out
}

/** 청크 번호 기준으로 합치고 정렬 (같은 번호는 새 것이 이긴다) */
export function mergeExtracts(prev: ChunkExtract[], add: ChunkExtract[]): ChunkExtract[] {
  const byIndex = new Map<number, ChunkExtract>()
  for (const c of prev) byIndex.set(c.chunkIndex, c)
  for (const c of add) byIndex.set(c.chunkIndex, c)
  return [...byIndex.values()].sort((a, b) => a.chunkIndex - b.chunkIndex)
}

export interface RoundResult {
  extracted: ChunkExtract[]
  phase: 'extracting' | 'extracted'
  progress: ExtractionProgress
  /** 이번 차수에서 실제로 시도한 청크 번호 */
  ran: number[]
  /** 일부 청크 실패 — 성공한 청크는 extracted에 이미 합쳐져 있다 (저장 후 던질 것) */
  failure: Error | null
}

/**
 * 한 차수 진행: 남은 청크 중 최대 CHUNKS_PER_REQUEST개를 병렬 추출하고 누적한다.
 * extract는 청크 하나를 추출하는 함수(재시도·반분할은 그쪽 책임). 실패한 청크가 있어도
 * 성공한 청크는 결과에 포함한다 — 다음 요청에서 남은 것만 다시 하도록.
 */
export async function advanceExtraction(
  state: { extracted: ChunkExtract[]; chunkTotal: number },
  extract: (chunkIndex: number) => Promise<ChunkExtract>,
): Promise<RoundResult> {
  const ran = nextRoundIndexes(state.chunkTotal, state.extracted.map((c) => c.chunkIndex))
  const settled = await Promise.allSettled(ran.map((i) => extract(i)))
  const ok: ChunkExtract[] = []
  let failure: Error | null = null
  settled.forEach((s) => {
    if (s.status === 'fulfilled') ok.push(s.value)
    else if (!failure) failure = s.reason instanceof Error ? s.reason : new Error(String(s.reason))
  })
  const extracted = mergeExtracts(state.extracted, ok)
  const progress = extractionProgress(extracted.length, state.chunkTotal)
  return { extracted, phase: progress.complete ? 'extracted' : 'extracting', progress, ran, failure }
}

/** 저장된 분할 분석 → 클라이언트 진행 응답 (/analyze·/extract 공용) */
export function toPhaseResponse(analysisId: string, stored: StoredAnalysis, cached: boolean): ExtractPhaseResponse {
  const done = stored.extracted?.length ?? 0
  const total = stored.chunkTotal ?? done
  const p = extractionProgress(done, total)
  return {
    phase: stored.phase === 'extracting' ? 'extracting' : 'extracted',
    analysisId,
    meta: stored.meta,
    cached,
    progress: { doneChunks: p.doneChunks, totalChunks: p.totalChunks, round: p.round, rounds: p.rounds },
  }
}
