'use client'

import { useState } from 'react'
import { Loader2, RefreshCw, BookOpen, Star, ArrowRight, Heart } from 'lucide-react'
import { cn } from '@/lib/utils'

type Period = 'week' | 'month' | 'quarter' | 'year'

interface Report {
  headline: string
  achievements: string[]
  improvements: string[]
  nextGoals: string[]
  encouragement: string
  cached?: boolean
}

const PERIOD_LABELS: Record<Period, string> = {
  week: '1주일', month: '1개월', quarter: '3개월', year: '1년',
}

export default function RetroReport() {
  const [period, setPeriod] = useState<Period>('week')
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    setReport(null)
    try {
      const res = await fetch(`/api/ai/report?period=${period}`)
      const data = await res.json()
      if (data.error) { setError('분석할 데이터가 없습니다.'); return }
      setReport(data)
    } catch {
      setError('리포트 생성 중 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">회고 리포트</h3>
          <p className="text-xs text-gray-500 mt-0.5">기간별 메모·플랜 데이터를 AI가 분석합니다</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-lg transition-colors"
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          생성하기
        </button>
      </div>

      {/* 기간 선택 */}
      <div className="flex gap-1.5">
        {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={cn(
              'px-3 py-1.5 text-xs rounded-lg border transition-colors',
              period === p
                ? 'border-violet-500 bg-violet-50 dark:bg-violet-950/30 text-violet-600'
                : 'border-gray-200 dark:border-gray-700 text-gray-500 hover:border-gray-300'
            )}
          >
            {PERIOD_LABELS[p]}
          </button>
        ))}
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {!report && !loading && !error && (
        <div className="flex flex-col items-center justify-center h-48 text-gray-400 gap-3">
          <BookOpen size={36} className="opacity-30" />
          <p className="text-sm">기간을 선택하고 생성하기를 눌러주세요</p>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center h-48 gap-2 text-gray-400">
          <Loader2 size={20} className="animate-spin" />
          <span className="text-sm">AI가 리포트를 작성 중입니다...</span>
        </div>
      )}

      {report && !loading && (
        <div className="space-y-5">
          {report.cached && (
            <p className="text-xs text-gray-400">캐시된 리포트 (24시간 내 생성)</p>
          )}

          {/* 헤드라인 */}
          <div className="p-4 bg-gradient-to-r from-violet-50 to-indigo-50 dark:from-violet-950/20 dark:to-indigo-950/20 rounded-xl">
            <p className="text-sm font-medium text-violet-700 dark:text-violet-300">&quot;{report.headline}&quot;</p>
          </div>

          {/* 성취 */}
          <Section icon={<Star size={14} />} title="이 기간의 성취" color="text-amber-500">
            {report.achievements?.map((a, i) => (
              <Item key={i} text={a} bullet="✓" color="text-amber-500" />
            ))}
          </Section>

          {/* 개선점 */}
          <Section icon={<ArrowRight size={14} />} title="더 나아질 부분" color="text-blue-500">
            {report.improvements?.map((a, i) => (
              <Item key={i} text={a} bullet="→" color="text-blue-500" />
            ))}
          </Section>

          {/* 다음 목표 */}
          <Section icon={<ArrowRight size={14} />} title="다음 기간 목표" color="text-green-500">
            {report.nextGoals?.map((a, i) => (
              <Item key={i} text={a} bullet={`${i + 1}.`} color="text-green-500" />
            ))}
          </Section>

          {/* 격려 */}
          {report.encouragement && (
            <div className="flex items-start gap-2 p-4 bg-pink-50 dark:bg-pink-950/20 rounded-xl">
              <Heart size={15} className="text-pink-400 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-pink-700 dark:text-pink-300">{report.encouragement}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Section({ icon, title, color, children }: { icon: React.ReactNode; title: string; color: string; children: React.ReactNode }) {
  return (
    <div>
      <p className={cn('text-xs font-semibold flex items-center gap-1.5 mb-2', color)}>{icon}{title}</p>
      <div className="space-y-1.5">{children}</div>
    </div>
  )
}

function Item({ text, bullet, color }: { text: string; bullet: string; color: string }) {
  return (
    <div className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
      <span className={cn('flex-shrink-0 text-xs font-medium mt-0.5 w-4', color)}>{bullet}</span>
      {text}
    </div>
  )
}
