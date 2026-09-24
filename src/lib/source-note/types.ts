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
export interface ChunkExtract {
  chunkIndex: number
  headings: string[]
  body: string
}

/** source_analyses.analysis jsonb 형태 */
export interface StoredAnalysis {
  result: SourceNoteAnalysis
  related: RelatedMemoRef[]
  meta: SourceMeta
  extracted?: ChunkExtract[]
}

/** analyze API 응답 */
export interface AnalyzeResponse {
  analysisId: string
  analysis: SourceNoteAnalysis
  related: RelatedMemoRef[]
  meta: SourceMeta
  cached: boolean
  createdAt: string
}
