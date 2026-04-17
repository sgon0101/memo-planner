'use client'

import { useState } from 'react'
import { Loader2, RefreshCw, Layers } from 'lucide-react'

interface Interest {
  keyword: string
  count: number
  category: string
}

interface InterestResult {
  interests: Interest[]
  topCategory: string
}

const CATEGORY_COLORS: Record<string, string> = {
  '기술': '#7F77DD', '개발': '#3B82F6', '건강': '#10B981', '독서': '#F59E0B',
  '여행': '#EC4899', '음악': '#8B5CF6', '운동': '#EF4444', '업무': '#6B7280',
}

function colorFor(category: string, i: number) {
  if (CATEGORY_COLORS[category]) return CATEGORY_COLORS[category]
  const palette = Object.values(CATEGORY_COLORS)
  return palette[i % palette.length]
}

export default function BubbleChart() {
  const [result, setResult] = useState<InterestResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/ai/insights?type=interest')
      const data = await res.json()
      if (data.error === 'no_data') { setError('분석할 메모가 없습니다.'); return }
      setResult(data)
    } catch {
      setError('분석 중 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  const interests = result?.interests ?? []
  const maxCount = Math.max(...interests.map((i) => i.count), 1)

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">관심사 버블 차트</h3>
          <p className="text-xs text-gray-500 mt-0.5">메모에서 자주 등장하는 키워드를 시각화합니다</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-lg transition-colors"
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          분석하기
        </button>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {!result && !loading && !error && (
        <div className="flex flex-col items-center justify-center h-48 text-gray-400 gap-3">
          <Layers size={36} className="opacity-30" />
          <p className="text-sm">분석하기 버튼을 눌러 관심사를 확인해보세요</p>
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
          {result.topCategory && (
            <p className="text-sm text-gray-600 dark:text-gray-400">
              가장 많이 등장한 카테고리: <span className="font-semibold text-violet-600">{result.topCategory}</span>
            </p>
          )}

          {/* 버블 레이아웃 */}
          <div className="flex flex-wrap gap-3 items-end">
            {interests.map((item, i) => {
              const size = 40 + (item.count / maxCount) * 80
              const color = colorFor(item.category, i)
              return (
                <div
                  key={i}
                  title={`${item.keyword} (${item.count}회) — ${item.category}`}
                  className="flex items-center justify-center rounded-full cursor-default transition-transform hover:scale-110 text-center"
                  style={{
                    width: size,
                    height: size,
                    backgroundColor: color + '22',
                    border: `2px solid ${color}`,
                    color,
                    fontSize: Math.max(10, size / 6),
                    fontWeight: 600,
                  }}
                >
                  <span className="px-1 leading-tight truncate max-w-full">{item.keyword}</span>
                </div>
              )
            })}
          </div>

          {/* 범례 */}
          <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100 dark:border-gray-800">
            {[...new Set(interests.map((i) => i.category))].map((cat, i) => (
              <span key={cat} className="flex items-center gap-1 text-xs text-gray-500">
                <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: colorFor(cat, i) }} />
                {cat}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
