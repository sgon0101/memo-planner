/**
 * OpenAI text-embedding-3-small 래퍼
 *
 * 모델: text-embedding-3-small
 * 차원: 1536
 * 비용: $0.02 / 1M tokens (사실상 무료)
 *
 * 사용:
 *   const vec = await embedText("내가 그제 만난 사람")
 *   → number[] (길이 1536)
 *
 * 환경변수: OPENAI_API_KEY (서버 전용 — Vercel에 등록)
 */

const OPENAI_EMBED_URL = 'https://api.openai.com/v1/embeddings'
const MODEL = 'text-embedding-3-small'
const DIMS = 1536

export const EMBEDDING_DIMS = DIMS

/** 단일 텍스트 임베딩 */
export async function embedText(input: string): Promise<number[]> {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error('OPENAI_API_KEY missing')

  // 토큰 제한 — 너무 길면 잘라서 보냄 (개략적으로 8000자 ≈ 4000 tokens)
  const text = input.length > 8000 ? input.slice(0, 8000) : input
  if (!text.trim()) throw new Error('empty input')

  const res = await fetch(OPENAI_EMBED_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      input: text,
    }),
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`OpenAI embedding failed: ${res.status} ${errText.slice(0, 200)}`)
  }
  const data = await res.json() as { data: Array<{ embedding: number[] }> }
  if (!data.data?.[0]?.embedding) throw new Error('OpenAI embedding response invalid')
  return data.data[0].embedding
}

/** 배치 임베딩 — backfill 효율화 (1회 요청에 최대 100개) */
export async function embedBatch(inputs: string[]): Promise<number[][]> {
  const key = process.env.OPENAI_API_KEY
  if (!key) throw new Error('OPENAI_API_KEY missing')

  const cleaned = inputs.map((t) => (t.length > 8000 ? t.slice(0, 8000) : t).trim() || ' ')

  const res = await fetch(OPENAI_EMBED_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      input: cleaned,
    }),
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`OpenAI batch embedding failed: ${res.status} ${errText.slice(0, 200)}`)
  }
  const data = await res.json() as { data: Array<{ embedding: number[]; index: number }> }
  // OpenAI는 index 순서를 보장하지만 안전하게 sort
  return data.data
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding)
}

/**
 * 메모를 임베딩하기 좋은 문자열로 조립
 * title + content_text 결합 — 둘 다 의미 전달에 중요
 */
export function buildMemoEmbeddingInput(title: string, contentText: string): string {
  const t = title?.trim() ?? ''
  const c = contentText?.trim() ?? ''
  if (!t && !c) return ''
  if (!t) return c
  if (!c) return t
  // 제목을 한 번 더 강조 — 검색 정확도 향상
  return `${t}\n\n${c}`
}
