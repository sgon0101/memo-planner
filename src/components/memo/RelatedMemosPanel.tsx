'use client'

/**
 * 의미 기반 관련 메모 패널
 *
 * - 현재 보고 있는 메모의 embedding으로 cosine 유사도 검색
 * - 상위 5개 표시, 클릭 시 그 메모로 이동
 * - 임베딩 없으면 안내 + "지금 생성" 버튼
 */

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles, RefreshCw, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

interface RelatedMemo {
  id: string
  title: string
  content_preview: string | null
  folder_id: string | null
  tags: string[]
  similarity: number
}

interface Props {
  memoId: string | null
  /** 메모 저장 직후 임베딩 갱신이 끝나도록 약간 지연 후 fetch — 새로고침 신호 */
  refreshKey?: number
}

/** 자동 임베딩(저장 후 5초 디바운스)이 끝나길 기다리는 재시도 — 총 ~7.5초 커버 */
const EMBED_POLL_RETRIES = 3
const EMBED_POLL_INTERVAL_MS = 2500

export default function RelatedMemosPanel({ memoId, refreshKey }: Props) {
  const router = useRouter()
  const [items, setItems] = useState<RelatedMemo[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [needsEmbedding, setNeedsEmbedding] = useState(false)
  // 재시도 타이머가 stale memoId로 fetch하지 않도록 최신 값 추적
  const memoIdRef = useRef(memoId)
  memoIdRef.current = memoId

  async function load(retriesLeft = EMBED_POLL_RETRIES) {
    if (!memoId) return
    const idAtCall = memoId
    setLoading(true)
    setError(null)
    setNeedsEmbedding(false)
    let scheduledRetry = false
    try {
      const res = await fetch(`/api/memos/${memoId}/related?limit=5&threshold=0.35`)
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error ?? 'failed')
      if (data.reason === 'no embedding yet') {
        // 자동 임베딩(저장 후 5초 디바운스)이 백그라운드 진행 중일 수 있음 —
        // 몇 번 더 기다렸다가, 그래도 없으면 수동 생성 안내 노출
        // ("고장난 것 같은" 첫인상 방지)
        if (retriesLeft > 0) {
          scheduledRetry = true
          setTimeout(() => {
            // 그 사이 다른 메모로 이동했으면 stale 재시도 중단
            if (memoIdRef.current === idAtCall) load(retriesLeft - 1)
          }, EMBED_POLL_INTERVAL_MS)
          return // loading 유지 — "분석 중…" 표시
        }
        setItems([])
        setNeedsEmbedding(true)
      } else {
        setItems(data.items ?? [])
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'failed')
      setItems([])
    } finally {
      if (!scheduledRetry) setLoading(false)
    }
  }

  useEffect(() => {
    if (memoId) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memoId, refreshKey])

  async function generateEmbedding() {
    if (!memoId) return
    setLoading(true)
    try {
      // generate 라우트는 임베딩 저장까지 완료 후 응답하므로 응답 직후 즉시 조회 가능
      // (기존 setTimeout 500ms 고정 대기는 레이스 여지가 있었음)
      await fetch('/api/embeddings/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memoId }),
      })
      await load(0)
    } catch {
      setLoading(false)
    }
  }

  if (!memoId) return null

  return (
    <div className="border-t border-gray-100 dark:border-gray-800 pt-4 mt-4">
      <div className="flex items-center justify-between mb-2 px-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-600 dark:text-gray-400">
          <Sparkles size={12} className="text-violet-500" />
          관련 메모
        </div>
        <button
          onClick={() => load(0)}
          disabled={loading}
          className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 disabled:opacity-50"
          title="다시 분석"
        >
          <RefreshCw size={11} className={cn(loading && 'animate-spin')} />
        </button>
      </div>

      {loading && items === null && (
        <div className="px-2 py-3 text-[11px] text-gray-400">분석 중…</div>
      )}

      {error && (
        <div className="px-2 py-3 text-[11px] text-red-500">{error}</div>
      )}

      {needsEmbedding && (
        <div className="px-2 py-3 space-y-2">
          <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
            이 메모는 아직 의미 분석이 안 됐어요.<br/>
            저장 후 잠시 기다리거나, 직접 분석할 수 있어요.
          </p>
          <button
            onClick={generateEmbedding}
            disabled={loading}
            className="text-[11px] px-2 py-1 rounded bg-violet-500 hover:bg-violet-600 text-white disabled:opacity-50 inline-flex items-center gap-1"
          >
            <Sparkles size={10} /> 지금 분석
          </button>
        </div>
      )}

      {items && items.length > 0 && (
        <div className="space-y-1">
          {items.map((m) => (
            <button
              key={m.id}
              onClick={() => router.push(`/memo/${m.id}`)}
              className="w-full text-left px-2 py-2 rounded-lg hover:bg-violet-50 dark:hover:bg-violet-950/30 group transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate group-hover:text-violet-700 dark:group-hover:text-violet-300">
                    {m.title || '제목 없음'}
                  </p>
                  {m.content_preview && (
                    <p className="text-[10px] text-gray-500 dark:text-gray-400 line-clamp-1 mt-0.5">
                      {m.content_preview}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-0.5 text-[10px] text-violet-500 font-mono opacity-60">
                  {Math.round(m.similarity * 100)}%
                  <ChevronRight size={10} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </div>
              {m.tags && m.tags.length > 0 && (
                <div className="flex gap-1 mt-1 flex-wrap">
                  {m.tags.slice(0, 3).map((t) => (
                    <span key={t} className="text-[9px] px-1 py-0.5 rounded bg-violet-100 dark:bg-violet-950/40 text-violet-600 dark:text-violet-400">
                      #{t}
                    </span>
                  ))}
                </div>
              )}
            </button>
          ))}
        </div>
      )}

      {items && items.length === 0 && !needsEmbedding && !loading && (
        <div className="px-2 py-3 text-[11px] text-gray-400">
          유사한 메모가 아직 없어요.
        </div>
      )}
    </div>
  )
}
