/**
 * 소스 노트 분석 클라이언트 흐름 — 요청 함수를 주입받는 순수 루프 (스토어·흐름 테스트 공용)
 *
 * /analyze → (분할 경로면) /extract를 남은 청크가 없을 때까지 반복 → /synthesize
 * 각 요청은 Vercel 300초 한도 안에 들도록 서버가 일을 쪼갠다(추출 1차수 = 요청 1개, 종합 = 요청 1개).
 * 중간에 실패하면 오류를 돌려주고, 다시 실행하면 /analyze가 캐시된 진행 상태를 돌려줘
 * 완료된 청크는 재사용하고 남은 것만 이어서 한다 (한도 차감 없음).
 */

import type { AnalyzeResponse, ExtractPhaseResponse } from './types'

export type FlowPhase =
  | { kind: 'read' }
  | { kind: 'extract'; round: number; rounds: number }
  | { kind: 'synthesize'; rounds?: number }

export type PostFn = (url: string, payload: unknown) => Promise<{ ok: boolean; status: number; data: unknown }>

export type FlowResult =
  | { ok: true; response: AnalyzeResponse }
  | { ok: false; error: string }

export const SOURCE_NOTE_ENDPOINTS = {
  analyze: '/api/ai/source-note/analyze',
  extract: '/api/ai/source-note/extract',
  synthesize: '/api/ai/source-note/synthesize',
} as const

/** 추출 이어 받기 최대 요청 수 — 150조각 = 17청크 = 4차수라 넉넉한 상한 (무한 루프 방지) */
const MAX_EXTRACT_REQUESTS = 12

const errorOf = (r: { status: number; data: unknown }, fallback: string) =>
  ((r.data as { error?: string } | null)?.error) || `${fallback} (${r.status})`

export async function runSourceNoteFlow(opts: {
  fileIds: string[]
  force?: boolean
  post: PostFn
  onPhase?: (phase: FlowPhase) => void
  /** 다른 분석이 시작돼 이 흐름을 그만둬야 하면 true */
  isStale?: () => boolean
}): Promise<FlowResult | null> {
  const { post, onPhase, isStale } = opts
  onPhase?.({ kind: 'read' })
  let r = await post(SOURCE_NOTE_ENDPOINTS.analyze, { fileIds: opts.fileIds, force: !!opts.force })
  if (!r.ok) return { ok: false, error: errorOf(r, '분석에 실패했어요') }

  let data = r.data as ExtractPhaseResponse | AnalyzeResponse
  let lastDone = -1
  for (let i = 0; data.phase === 'extracting'; i++) {
    if (isStale?.()) return null
    const d = data as ExtractPhaseResponse
    const done = d.progress?.doneChunks ?? 0
    // 진행이 없는데 서버가 계속 extracting이면 중단 (같은 청크만 실패를 반복하는 경우 등)
    if (i >= MAX_EXTRACT_REQUESTS || done === lastDone) {
      return { ok: false, error: '긴 자료를 끝까지 읽지 못했어요. 잠시 후 다시 시도해주세요.' }
    }
    lastDone = done
    onPhase?.({ kind: 'extract', round: d.progress?.round ?? i + 2, rounds: d.progress?.rounds ?? 0 })
    r = await post(SOURCE_NOTE_ENDPOINTS.extract, { analysisId: d.analysisId })
    if (!r.ok) return { ok: false, error: errorOf(r, '긴 자료를 읽는 중에 실패했어요') }
    data = r.data as ExtractPhaseResponse
  }

  if (data.phase === 'extracted') {
    if (isStale?.()) return null
    const d = data as ExtractPhaseResponse
    onPhase?.({ kind: 'synthesize', rounds: d.progress?.rounds })
    r = await post(SOURCE_NOTE_ENDPOINTS.synthesize, { analysisId: d.analysisId })
    if (!r.ok) return { ok: false, error: errorOf(r, '내용 종합에 실패했어요') }
    return { ok: true, response: r.data as AnalyzeResponse }
  }
  return { ok: true, response: data as AnalyzeResponse }
}
