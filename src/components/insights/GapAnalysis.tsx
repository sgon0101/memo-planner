'use client'

import { useState, useEffect, useCallback } from 'react'
import { Loader2, RefreshCw, TrendingUp, AlertCircle, Lightbulb } from 'lucide-react'
import { cn } from '@/lib/utils'

interface GapItem {
  topic: string
  memo: string
  plan: string
  score: number
}

interface GapResult {
  gaps: GapItem[]
  summary: string
  suggestions: string[]
  cached?: boolean
}

export default function GapAnalysis() {
  const [result, setResult] = useState<GapResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async (force = false) => {
    setLoading(true)
    setError('')
    try {
      const url = force ? '/api/ai/insights?type=gap&force=1' : '/api/ai/insights?type=gap'
      const res = await fetch(url)
      const data = await res.json()
      if (!res.ok || data.error) {
        if (data.error === 'no_data') setError('분석할 메모가 없습니다. 먼저 메모를 작성해보세요!')
        else setError(data.error ?? '분석 중 오류가 발생했습니다.')
        return
      }
      if (!data.gaps) { setError('AI 응답 형식이 올바르지 않습니다. 다시 시도해주세요.'); return }
      setResult(data)
    } catch {
      setError('분석 중 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }, [])

  // 마운트 시 캐시 결과 자동 로드 (API 비용 없음 — DB 캐시 반환)
  useEffect(() => { load() }, [load])

  function scoreColor(score: number) {
    if (score >= 70) return 'text-green-500'
    if (score >= 40) return 'text-amber-500'
    return 'text-red-400'
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">생각 — 행동 갭 분석</h3>
          <p className="text-xs text-gray-500 mt-0.5">메모의 관심사와 실제 플랜의 일치도를 분석합니다</p>
        </div>
        <div className="flex items-center gap-2">
          {result?.cached && (
            <span className="text-[10px] text-gray-400 dark:text-gray-500">캐시됨 (24h)</span>
          )}
          <button
            onClick={() => load(true)}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-lg transition-colors"
          >
            {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            {result ? '재분석' : '분석하기'}
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-950/20 rounded-lg text-sm text-red-500">
          <AlertCircle size={15} /> {error}
        </div>
      )}

      {!result && !loading && !error && (
        <div className="flex flex-col items-center justify-center h-48 text-gray-400 gap-3">
          <TrendingUp size={36} className="opacity-30" />
          <p className="text-sm">분석하기 버튼을 눌러 갭을 확인해보세요</p>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center h-48 gap-2 text-gray-400">
          <Loader2 size={20} className="animate-spin" />
          <span className="text-sm">AI가 분석 중입니다...</span>
        </div>
      )}

      {result && !loading && (
        <div className="space-y-5">
          {/* 요약 */}
          <div className="p-4 bg-violet-50 dark:bg-violet-950/20 rounded-xl text-sm text-violet-700 dark:text-violet-300">
            {result.summary}
          </div>

          {/* 갭 목록 */}
          <div className="space-y-3">
            {result.gaps?.map((g, i) => (
              <div key={i} className="p-4 rounded-xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{g.topic}</span>
                  <span className={cn('text-xs font-bold', scoreColor(g.score))}>{g.score}점</span>
                </div>
                <div className="w-full h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden mb-3">
                  <div
                    className={cn('h-full rounded-full transition-all', g.score >= 70 ? 'bg-green-400' : g.score >= 40 ? 'bg-amber-400' : 'bg-red-400')}
                    style={{ width: `${g.score}%` }}
                  />
                </div>
                <p className="text-xs text-gray-500">메모: {g.memo}</p>
                <p className="text-xs text-gray-500 mt-0.5">플랜: {g.plan}</p>
              </div>
            ))}
          </div>

          {/* 제안 */}
          {result.suggestions?.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-gray-600 dark:text-gray-400 flex items-center gap-1.5">
                <Lightbulb size={13} /> 개선 제안
              </p>
              {result.suggestions.map((s, i) => (
                <div key={i} className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
                  <span className="mt-0.5 w-4 h-4 rounded-full bg-violet-100 dark:bg-violet-900/30 text-violet-600 text-xs flex items-center justify-center flex-shrink-0">{i + 1}</span>
                  {s}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
