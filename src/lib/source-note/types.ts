/**
 * 소스 노트(PDF·이미지 묶음 → 요약 노트) 공용 타입 — 서버·클라이언트 공유
 */

export type SuggestionSource = 'existing' | 'new' | 'neighbor'

export interface NoteSuggestion {
  name: string
  source: SuggestionSource
  reason: string
  /** source === 'neighbor'일 때 — 이 위키를 가진 유사 메모 수 */
  neighborCount?: number
  /** 이 자료의 핵심 개념(concepts)에서 서버가 만든 새 위키 후보 — 모달 기본 해제 */
  fromConcept?: boolean
}

/** Claude 응답 스키마 (4-3) + 서버 후처리로 neighbor가 추가될 수 있다 */
export interface SourceNoteAnalysis {
  title: string
  oneLiner: string
  keyPoints: string[]
  sections: { heading: string; bullets: string[] }[]
  concepts: { name: string; definition: string }[]
  quotes: { text: string; loc?: string }[]
  wikiSuggestions: NoteSuggestion[]
  tagSuggestions: NoteSuggestion[]
  textAmount: 'rich' | 'some' | 'low'
}

export interface RelatedMemoRef {
  id: string
  title: string
  similarity: number
}

/** 입력 경로 — 디버깅·비용 표용 */
export type SourceInputMode = 'text-pdf' | 'image-pdf' | 'image-pdf-fallback' | 'images'

export interface SourceMeta {
  kind: 'pdf' | 'images'
  mode: SourceInputMode
  fileNames: string[]
  pageCount: number | null
  imageCount: number
  tileCount: number
  chunked: boolean
}

/** 분할 추출 청크 (3-3) — [다시 분석] 시 재사용 */
export interface QuoteCandidate {
  /** 원문 그대로 (압축·수정 금지) */
  text: string
  loc?: string
}

export interface ChunkExtract {
  chunkIndex: number
  headings: string[]
  /** 압축 전사 본문 */
  body: string
  /**
   * 인용 후보 — 따옴표·강조·결론 문장을 압축하지 않고 원문 그대로 보존.
   * 종합 단계의 quotes는 이 목록에서만 번호로 고른다 (압축 본문에서 인용을 뽑으면 원문이 아니게 된다).
   */
  quoteCandidates?: QuoteCandidate[]
}

/** source_analyses.analysis jsonb 형태 */
export interface StoredAnalysis {
  /**
   * 분할 경로는 300초 한도 때문에 요청을 나눈다:
   *  'extracting' = 청크 추출 진행 중(요청 하나 = 병렬 1차수, 청크 단위 누적 캐시)
   *  'extracted'  = 추출 완료, 종합 대기
   *  'done'(또는 없음, 이전 행 호환) = 종합 완료
   */
  phase?: 'extracting' | 'extracted' | 'done'
  /** phase 'extracting'/'extracted'에서는 없을 수 있다 (재분석 중이면 이전 결과가 남아 있음) */
  result?: SourceNoteAnalysis
  related?: RelatedMemoRef[]
  meta: SourceMeta
  /** 완료된 청크 추출문 (청크 번호 순) */
  extracted?: ChunkExtract[]
  /** 분할 청크 총수 — extracted.length와 비교해 남은 청크를 안다 */
  chunkTotal?: number
}

/** 분석 완료 응답 (analyze 단일 경로 · synthesize) */
export interface AnalyzeResponse {
  phase?: 'done'
  analysisId: string
  analysis: SourceNoteAnalysis
  related: RelatedMemoRef[]
  meta: SourceMeta
  cached: boolean
  createdAt: string
}

/**
 * 분할 경로 응답 — 'extracting'이면 클라이언트가 /extract를 이어서 호출,
 * 'extracted'면 /synthesize로 넘어간다.
 */
export interface ExtractPhaseResponse {
  phase: 'extracting' | 'extracted'
  analysisId: string
  meta: SourceMeta
  cached: boolean
  progress?: {
    doneChunks: number
    totalChunks: number
    /** 다음에 실행할 추출 차수 (1부터) */
    round: number
    rounds: number
  }
}
