'use client'

import { useState } from 'react'
import { Loader2, RefreshCw, Network } from 'lucide-react'

interface Interest {
  keyword: string
  count: number
  category: string
}

const CATEGORY_COLORS: Record<string, string> = {
  '기술': '#7F77DD', '개발': '#3B82F6', '건강': '#10B981', '독서': '#F59E0B',
  '여행': '#EC4899', '음악': '#8B5CF6', '운동': '#EF4444', '업무': '#6B7280',
}
function colorFor(cat: string, i: number) {
  if (CATEGORY_COLORS[cat]) return CATEGORY_COLORS[cat]
  return Object.values(CATEGORY_COLORS)[i % 8]
}

export default function MindMap() {
  const [interests, setInterests] = useState<Interest[]>([])
  const [topCategory, setTopCategory] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/ai/insights?type=interest')
      const data = await res.json()
      if (data.error === 'no_data') { setError('분석할 메모가 없습니다.'); return }
      setInterests(data.interests ?? [])
      setTopCategory(data.topCategory ?? '')
    } catch {
      setError('분석 중 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  // 카테고리별 그룹핑
  const groups: Record<string, Interest[]> = {}
  for (const item of interests) {
    if (!groups[item.category]) groups[item.category] = []
    groups[item.category].push(item)
  }
  const categories = Object.keys(groups)

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">관심사 마인드맵</h3>
          <p className="text-xs text-gray-500 mt-0.5">카테고리별 키워드 연결을 시각화합니다</p>
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

      {!interests.length && !loading && !error && (
        <div className="flex flex-col items-center justify-center h-48 text-gray-400 gap-3">
          <Network size={36} className="opacity-30" />
          <p className="text-sm">분석하기 버튼을 눌러 마인드맵을 확인해보세요</p>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center h-48 gap-2 text-gray-400">
          <Loader2 size={20} className="animate-spin" />
          <span className="text-sm">AI가 분석 중입니다...</span>
        </div>
      )}

      {interests.length > 0 && !loading && (
        <div className="space-y-4">
          {/* 중심 노드 */}
          <div className="flex justify-center">
            <div className="px-4 py-2 rounded-full bg-violet-600 text-white text-sm font-semibold shadow">
              나의 관심사
            </div>
          </div>

          {/* 카테고리별 그룹 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {categories.map((cat, ci) => {
              const color = colorFor(cat, ci)
              return (
                <div key={cat} className="rounded-xl border-2 p-4 space-y-2" style={{ borderColor: color + '44' }}>
                  <div
                    className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold"
                    style={{ backgroundColor: color + '22', color }}
                  >
                    {cat}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {groups[cat].map((item, ki) => (
                      <span
                        key={ki}
                        className="px-2 py-0.5 rounded-full text-xs"
                        style={{ backgroundColor: color + '15', color, border: `1px solid ${color}44` }}
                      >
                        {item.keyword} <span className="opacity-60">·{item.count}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>

          {topCategory && (
            <p className="text-xs text-center text-gray-400">
              핵심 관심사: <span className="text-violet-600 font-medium">{topCategory}</span>
            </p>
          )}
        </div>
      )}
    </div>
  )
}
