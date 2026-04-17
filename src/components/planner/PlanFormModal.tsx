'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import { usePlanner } from '@/hooks/usePlanner'
import type { Plan } from '@/types'

const PRESET_COLORS = [
  '#7F77DD', '#3B82F6', '#10B981', '#F59E0B',
  '#EF4444', '#EC4899', '#8B5CF6', '#6B7280',
]

interface PlanFormModalProps {
  date: string
  plan?: Plan
  onClose: () => void
  onSaved: () => void
}

export default function PlanFormModal({ date, plan, onClose, onSaved }: PlanFormModalProps) {
  const { createPlan, editPlan } = usePlanner()

  const [title, setTitle] = useState(plan?.title ?? '')
  const [color, setColor] = useState(plan?.color ?? '#7F77DD')
  const [isRange, setIsRange] = useState(!!(plan?.startDate))
  const [startDate, setStartDate] = useState(plan?.startDate ?? date)
  const [endDate, setEndDate] = useState(plan?.endDate ?? date)
  const [startTime, setStartTime] = useState(plan?.startTime?.slice(0, 5) ?? '')
  const [endTime, setEndTime] = useState(plan?.endTime?.slice(0, 5) ?? '')
  const [isAllDay, setIsAllDay] = useState(plan?.isAllDay ?? true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) { setError('제목을 입력하세요.'); return }
    setLoading(true)
    try {
      const data: Partial<Plan> = {
        title: title.trim(),
        color,
        isAllDay,
        date: isRange ? null : date,
        startDate: isRange ? startDate : null,
        endDate: isRange ? endDate : null,
        startTime: isAllDay ? null : (startTime || null),
        endTime: isAllDay ? null : (endTime || null),
      }
      if (plan) {
        await editPlan(plan.id, data)
      } else {
        await createPlan(data)
      }
      onSaved()
    } catch (e) {
      setError('저장 중 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-xl p-6 w-96" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
            {plan ? '플랜 수정' : '새 플랜'}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
            <X size={15} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* 제목 */}
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="플랜 제목"
            autoFocus
            className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
          />

          {/* 색상 */}
          <div>
            <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">색상</p>
            <div className="flex gap-2 flex-wrap">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={cn('w-6 h-6 rounded-full transition-transform hover:scale-110', color === c && 'ring-2 ring-offset-2 ring-gray-400')}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          {/* 날짜 유형 */}
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400 cursor-pointer">
              <input type="checkbox" checked={isRange} onChange={(e) => setIsRange(e.target.checked)} className="accent-violet-600" />
              범위 플랜
            </label>
            <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400 cursor-pointer">
              <input type="checkbox" checked={isAllDay} onChange={(e) => setIsAllDay(e.target.checked)} className="accent-violet-600" />
              종일
            </label>
          </div>

          {/* 날짜 */}
          {isRange ? (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-xs text-gray-500 mb-1">시작일</p>
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-violet-500" />
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">종료일</p>
                <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} min={startDate}
                  className="w-full px-2.5 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-violet-500" />
              </div>
            </div>
          ) : (
            <div>
              <p className="text-xs text-gray-500 mb-1">날짜</p>
              <input type="date" value={date} readOnly
                className="w-full px-2.5 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-500 outline-none" />
            </div>
          )}

          {/* 시간 (종일 아닐 때) */}
          {!isAllDay && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-xs text-gray-500 mb-1">시작 시간</p>
                <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-violet-500" />
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">종료 시간</p>
                <input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-violet-500" />
              </div>
            </div>
          )}

          {error && <p className="text-xs text-red-500 bg-red-50 dark:bg-red-950/30 px-3 py-2 rounded-lg">{error}</p>}

          <button type="submit" disabled={loading}
            className="w-full py-2.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors">
            {loading ? '저장 중...' : plan ? '수정' : '추가'}
          </button>
        </form>
      </div>
    </div>
  )
}

// cn 임포트 누락 방지
function cn(...classes: (string | boolean | undefined)[]) {
  return classes.filter(Boolean).join(' ')
}
