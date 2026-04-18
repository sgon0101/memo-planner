'use client'

import { useRouter } from 'next/navigation'
import { X, Pencil, Trash2, Check, Calendar, Clock, RepeatIcon, FileText } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { ko } from 'date-fns/locale'
import { cn } from '@/lib/utils'
import { useMemoStore } from '@/store/memoStore'
import { usePlanner } from '@/hooks/usePlanner'
import type { Plan } from '@/types'

interface PlanDetailPanelProps {
  plan: Plan
  onEdit: () => void
  onClose: () => void
}

const REPEAT_LABEL: Record<string, string> = {
  daily: '매일 반복',
  weekly: '매주 반복',
  monthly: '매월 반복',
}

export default function PlanDetailPanel({ plan, onEdit, onClose }: PlanDetailPanelProps) {
  const router = useRouter()
  const { memos } = useMemoStore()
  const { toggleComplete, removePlan } = usePlanner()

  const linkedMemos = (plan.linkedMemoIds ?? [])
    .map((id) => memos.find((m) => m.id === id))
    .filter(Boolean)

  async function handleDelete() {
    if (!confirm('플랜을 삭제할까요?')) return
    await removePlan(plan.id).catch(console.error)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div
        className="w-full max-w-sm h-full bg-white dark:bg-gray-900 shadow-2xl flex flex-col overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-2.5">
            <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: plan.color }} />
            <h2 className={cn('text-sm font-semibold text-gray-900 dark:text-white', plan.isCompleted && 'line-through text-gray-400')}>
              {plan.title}
            </h2>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800">
            <X size={15} />
          </button>
        </div>

        {/* 완료 상태 */}
        <div className="px-5 py-3 border-b border-gray-50 dark:border-gray-800/50">
          <button
            onClick={() => toggleComplete(plan.id, plan.isCompleted).catch(console.error)}
            className={cn(
              'flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
              plan.isCompleted
                ? 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
            )}
          >
            <Check size={13} />
            {plan.isCompleted ? '완료됨' : '완료 표시'}
          </button>
        </div>

        {/* 상세 정보 */}
        <div className="flex-1 px-5 py-4 space-y-4">
          {/* 날짜 */}
          <div className="flex items-start gap-3">
            <Calendar size={15} className="text-gray-400 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-gray-700 dark:text-gray-300">
              {plan.startDate && plan.endDate ? (
                <>
                  <p>{format(parseISO(plan.startDate), 'yyyy년 M월 d일 (EEE)', { locale: ko })}</p>
                  <p className="text-gray-400">~ {format(parseISO(plan.endDate), 'M월 d일 (EEE)', { locale: ko })}</p>
                </>
              ) : plan.date ? (
                <p>{format(parseISO(plan.date), 'yyyy년 M월 d일 (EEE)', { locale: ko })}</p>
              ) : null}
            </div>
          </div>

          {/* 시간 */}
          {!plan.isAllDay && plan.startTime && (
            <div className="flex items-center gap-3">
              <Clock size={15} className="text-gray-400 flex-shrink-0" />
              <span className="text-sm text-gray-700 dark:text-gray-300">
                {plan.startTime.slice(0, 5)}{plan.endTime ? ` ~ ${plan.endTime.slice(0, 5)}` : ''}
              </span>
            </div>
          )}
          {plan.isAllDay && (
            <div className="flex items-center gap-3">
              <Clock size={15} className="text-gray-400 flex-shrink-0" />
              <span className="text-sm text-gray-400">종일</span>
            </div>
          )}

          {/* 반복 */}
          {plan.repeatType && (
            <div className="flex items-center gap-3">
              <RepeatIcon size={15} className="text-violet-400 flex-shrink-0" />
              <span className="text-sm text-violet-600 dark:text-violet-400">{REPEAT_LABEL[plan.repeatType]}</span>
            </div>
          )}

          {/* 설명 */}
          {plan.description && (
            <div className="pt-2 border-t border-gray-100 dark:border-gray-800">
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">설명</p>
              <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">{plan.description}</p>
            </div>
          )}

          {/* 연결된 메모 */}
          {linkedMemos.length > 0 && (
            <div className="pt-2 border-t border-gray-100 dark:border-gray-800">
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">연결된 메모</p>
              <div className="space-y-1">
                {linkedMemos.map((memo) => memo && (
                  <button
                    key={memo.id}
                    onClick={() => router.push(`/memo/${memo.id}`)}
                    className="w-full flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-800 rounded-lg hover:bg-violet-50 dark:hover:bg-violet-950/20 text-left transition-colors group"
                  >
                    <FileText size={13} className="text-gray-400 group-hover:text-violet-500 flex-shrink-0" />
                    <span className="text-xs text-gray-700 dark:text-gray-300 truncate group-hover:text-violet-600">
                      {memo.title || '제목 없음'}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 액션 버튼 */}
        <div className="flex gap-2 px-5 py-4 border-t border-gray-100 dark:border-gray-800">
          <button
            onClick={onEdit}
            className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Pencil size={13} /> 수정
          </button>
          <button
            onClick={handleDelete}
            className="flex items-center justify-center gap-1.5 px-4 py-2 bg-red-50 dark:bg-red-950/20 hover:bg-red-100 dark:hover:bg-red-950/40 text-red-500 text-sm font-medium rounded-lg transition-colors"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </div>
  )
}
