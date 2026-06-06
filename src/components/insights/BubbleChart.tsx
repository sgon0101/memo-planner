'use client'

import { useState, useRef, useEffect } from 'react'
import { Loader2, RefreshCw, Layers } from 'lucide-react'
import { cn } from '@/lib/utils'

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
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [isMobile, setIsMobile] = useState(false)
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({})

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  async function load() {
    setLoading(true)
    setError('')
    setSelectedCategory(null)
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

  function handleBubbleClick(item: Interest) {
    const next = selectedCategory === item.category ? null : item.category
    setSelectedCategory(next)
    if (next) {
      setTimeout(() => {
        cardRefs.current[next]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      }, 50)
    }
  }

  const interests = result?.interests ?? []
  const maxCount = Math.max(...interests.map((i) => i.count), 1)

  // 카테고리별 그룹핑
  const groups: Record<string, Interest[]> = {}
  for (const item of interests) {
    if (!groups[item.category]) groups[item.category] = []
    groups[item.category].push(item)
  }
  const categories = Object.keys(groups)
  const categoryColorIndex = Object.fromEntries(categories.map((c, i) => [c, i]))

  return (
    <div className="p-4 md:p-6 space-y-5 md:space-y-6">
      {/* 헤더 */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">관심사 분석</h3>
          <p className="text-xs text-gray-500 mt-0.5">AI가 내 메모를 분석해 관심사와 주제별 키워드를 정리해드려요</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 md:py-1.5 text-xs font-medium bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-lg transition-colors"
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          분석하기
        </button>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {/* 빈 상태 */}
      {!result && !loading && !error && (
        <div className="flex flex-col items-center justify-center h-48 text-gray-400 gap-3">
          <Layers size={36} className="opacity-30" />
          <p className="text-sm">분석하기 버튼을 눌러 관심사를 확인해보세요</p>
        </div>
      )}

      {/* 로딩 */}
      {loading && (
        <div className="space-y-6">
          {/* 버블 스켈레톤 */}
          <div className="space-y-2">
            <div className="h-3 w-40 bg-gray-100 dark:bg-gray-800 rounded animate-pulse" />
            <div className="flex flex-wrap gap-3 items-end">
              {[80, 120, 60, 100, 70, 90, 50].map((s, i) => (
                <div key={i} className="rounded-full bg-gray-100 dark:bg-gray-800 animate-pulse" style={{ width: s, height: s }} />
              ))}
            </div>
          </div>
          {/* 카드 스켈레톤 */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="rounded-xl border border-gray-100 dark:border-gray-800 p-4 space-y-3 animate-pulse">
                <div className="h-5 w-24 bg-gray-100 dark:bg-gray-800 rounded-full" />
                <div className="flex flex-wrap gap-1.5">
                  {[60, 80, 50, 70].map((w, j) => <div key={j} className="h-5 rounded-full bg-gray-100 dark:bg-gray-800" style={{ width: w }} />)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {result && !loading && (
        <div className="space-y-8">
          {/* ── 1단계: 버블 차트 ── */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">1단계 · 관심사 버블 차트</span>
              {selectedCategory && (
                <button
                  onClick={() => setSelectedCategory(null)}
                  className="text-xs text-violet-500 hover:text-violet-700 underline"
                >
                  전체 보기
                </button>
              )}
            </div>
            <p className="text-xs text-gray-400 mb-4">버블을 클릭하면 해당 카테고리가 강조됩니다</p>

            {result.topCategory && (
              <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                가장 많이 등장한 카테고리: <span className="font-semibold text-violet-600">{result.topCategory}</span>
              </p>
            )}

            <div className="flex flex-wrap gap-3 items-end">
              {interests.map((item, i) => {
                // 모바일: 40~100px (Apple HIG 터치 최소 44px 권장 반영) / 데스크톱: 40~120px
                const size = isMobile
                  ? 40 + (item.count / maxCount) * 60
                  : 40 + (item.count / maxCount) * 80
                const color = colorFor(item.category, categoryColorIndex[item.category])
                const isSelected = selectedCategory === item.category
                const isDimmed = selectedCategory !== null && !isSelected
                return (
                  <button
                    key={i}
                    onClick={() => handleBubbleClick(item)}
                    title={`${item.keyword} (${item.count}회) — ${item.category}`}
                    className={cn(
                      'flex items-center justify-center rounded-full transition-all duration-200 text-center focus:outline-none',
                      isSelected && 'ring-2 ring-offset-2 scale-110',
                      isDimmed && 'opacity-30'
                    )}
                    style={{
                      width: size,
                      height: size,
                      backgroundColor: color + '22',
                      border: `2px solid ${color}`,
                      color,
                      fontSize: Math.max(12, size / 5),
                      fontWeight: 600,
                      ringColor: color,
                    } as React.CSSProperties}
                  >
                    <span className="px-1 leading-tight truncate max-w-full">{item.keyword}</span>
                  </button>
                )
              })}
            </div>

            {/* 범례 */}
            <div className="flex flex-wrap gap-x-3 gap-y-2 pt-3 mt-3 border-t border-gray-100 dark:border-gray-800">
              {categories.map((cat, i) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(selectedCategory === cat ? null : cat)}
                  className={cn(
                    'flex items-center gap-1.5 text-xs py-1 transition-opacity',
                    selectedCategory !== null && selectedCategory !== cat ? 'opacity-30' : 'text-gray-500'
                  )}
                >
                  <span className="w-2.5 h-2.5 rounded-full inline-block flex-shrink-0" style={{ backgroundColor: colorFor(cat, i) }} />
                  {cat}
                </button>
              ))}
            </div>
          </section>

          {/* ── 2단계: 카테고리 카드 그리드 ── */}
          <section>
            <div className="mb-3">
              <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">2단계 · 주제별 키워드 그룹</span>
            </div>
            <p className="text-xs text-gray-400 mb-4">AI가 분류한 주제별 관심사 키워드예요</p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {categories.map((cat, ci) => {
                const color = colorFor(cat, ci)
                const isSelected = selectedCategory === cat
                const isDimmed = selectedCategory !== null && !isSelected
                return (
                  <div
                    key={cat}
                    ref={(el) => { cardRefs.current[cat] = el }}
                    onClick={() => setSelectedCategory(isSelected ? null : cat)}
                    className={cn(
                      'rounded-xl border-2 p-3 sm:p-4 space-y-2 cursor-pointer transition-all duration-200',
                      isSelected ? 'scale-[1.02] shadow-md' : isDimmed ? 'opacity-40' : 'hover:shadow-sm'
                    )}
                    style={{ borderColor: isSelected ? color : color + '44' }}
                  >
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

            {result.topCategory && (
              <p className="text-xs text-center text-gray-400 mt-4">
                핵심 관심사: <span className="text-violet-600 font-medium">{result.topCategory}</span>
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
