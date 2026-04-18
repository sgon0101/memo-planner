'use client'

import { useState } from 'react'
import { X, Plus, Check, Trash2, Clock, Pencil } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { ko } from 'date-fns/locale'
import { cn } from '@/lib/utils'
import { usePlannerStore } from '@/store/plannerStore'
import { usePlanner } from '@/hooks/usePlanner'
import PlanDetailPanel from './PlanDetailPanel'
import type { Plan } from '@/types'

type DeleteMode = null | 'confirm' | 'recurring'

interface PlanPanelProps {
  date: string
  onNewPlan: () => void
  onEditPlan: (plan: Plan) => void
  onClose: () => void
}

export default function PlanPanel({ date, onNewPlan, onEditPlan, onClose }: PlanPanelProps) {
  const { expandedPlans } = usePlannerStore()
  const { toggleComplete, removePlan, toggleRecurringComplete, skipRecurringInstance, stopRecurringFromDate } = usePlanner()
  const [detailPlan, setDetailPlan] = useState<Plan | null>(null)
  const [deletingPlan, setDeletingPlan] = useState<Plan | null>(null)

  const dayPlans = expandedPlans.filter((p) => {
    if (p.date === date) return true
    if (p.startDate && p.endDate) {
      return p.startDate <= date && p.endDate >= date
    }
    return false
  })

  const displayDate = format(parseISO(date), 'M월 d일 (EEE)', { locale: ko })
  const isToday = date === format(new Date(), 'yyyy-MM-dd')

  return (
    <div className="w-full md:w-72 flex-shrink-0 flex flex-col border-t md:border-t-0 md:border-l border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 rounded-t-2xl md:rounded-none shadow-2xl md:shadow-none max-h-[60vh] md:max-h-none">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800">
        <div>
          <p className={cn('text-sm font-semibold', isToday ? 'text-violet-600' : 'text-gray-900 dark:text-white')}>
            {displayDate}
          </p>
          {isToday && <p className="text-xs text-violet-500">오늘</p>}
        </div>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
          <X size={15} />
        </button>
      </div>

      {/* 플랜 목록 */}
      <div className="flex-1 overflow-y-auto">
        {dayPlans.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-gray-400 gap-2">
            <Clock size={20} className="opacity-40" />
            <p className="text-xs">플랜이 없습니다</p>
          </div>
        ) : (
          <ul className="p-2 space-y-1">
            {dayPlans.map((plan) => (
              <PlanItem
                key={plan.id}
                plan={plan}
                onToggle={() => {
                  if (plan.isRecurringInstance && plan.originalPlanId && plan.date) {
                    toggleRecurringComplete(plan.originalPlanId, plan.date, plan.isCompleted).catch(console.error)
                  } else {
                    toggleComplete(plan.id, plan.isCompleted).catch(console.error)
                  }
                }}
                onEdit={() => onEditPlan(plan)}
                onDelete={() => setDeletingPlan(plan)}
                onDetail={() => setDetailPlan(plan)}
              />
            ))}
          </ul>
        )}
      </div>

      {/* 새 플랜 버튼 */}
      <div className="p-3 border-t border-gray-200 dark:border-gray-800">
        <button
          onClick={onNewPlan}
          className="w-full flex items-center justify-center gap-2 py-2 text-sm font-medium text-violet-600 hover:bg-violet-50 dark:hover:bg-violet-950/20 rounded-lg transition-colors"
        >
          <Plus size={15} /> 새 플랜 추가
        </button>
      </div>

      {/* 플랜 상세 패널 */}
      {detailPlan && (
        <PlanDetailPanel
          plan={detailPlan}
          onEdit={() => { setDetailPlan(null); onEditPlan(detailPlan) }}
          onDelete={(mode) => {
            const p = detailPlan
            setDetailPlan(null)
            if (!p.isRecurringInstance || !p.originalPlanId || !p.date) {
              removePlan(p.id).catch(console.error)
            } else if (mode === 'this') {
              skipRecurringInstance(p.originalPlanId, p.date).catch(console.error)
            } else if (mode === 'after') {
              stopRecurringFromDate(p.originalPlanId, p.date).catch(console.error)
            } else {
              removePlan(p.originalPlanId).catch(console.error)
            }
          }}
          onClose={() => setDetailPlan(null)}
        />
      )}

      {/* 반복 플랜 삭제 모달 */}
      {deletingPlan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setDeletingPlan(null)}>
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl p-5 w-72 mx-4" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-semibold text-gray-900 dark:text-white mb-1">플랜 삭제</p>
            {deletingPlan.isRecurringInstance ? (
              <>
                <p className="text-xs text-gray-500 mb-4">반복 일정입니다. 어떻게 삭제할까요?</p>
                <div className="space-y-2">
                  <button className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300"
                    onClick={() => { skipRecurringInstance(deletingPlan.originalPlanId!, deletingPlan.date!).catch(console.error); setDeletingPlan(null) }}>
                    이 일정만 삭제
                  </button>
                  <button className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300"
                    onClick={() => { stopRecurringFromDate(deletingPlan.originalPlanId!, deletingPlan.date!).catch(console.error); setDeletingPlan(null) }}>
                    이 일정 및 이후 모두 삭제
                  </button>
                  <button className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-red-50 dark:hover:bg-red-950/20 text-red-500"
                    onClick={() => { removePlan(deletingPlan.originalPlanId!).catch(console.error); setDeletingPlan(null) }}>
                    모든 반복 일정 삭제
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-xs text-gray-500 mb-4">이 플랜을 삭제할까요?</p>
                <div className="flex gap-2">
                  <button className="flex-1 py-2 text-sm rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300" onClick={() => setDeletingPlan(null)}>취소</button>
                  <button className="flex-1 py-2 text-sm rounded-lg bg-red-500 text-white" onClick={() => { removePlan(deletingPlan.id).catch(console.error); setDeletingPlan(null) }}>삭제</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function PlanItem({
  plan,
  onToggle,
  onEdit,
  onDelete,
  onDetail,
}: {
  plan: Plan
  onToggle: () => void
  onEdit: () => void
  onDelete: () => void
  onDetail: () => void
}) {
  const isRange = plan.startDate && plan.endDate

  const repeatLabel: Record<string, string> = {
    daily: '매일', weekly: '매주', monthly: '매월',
  }

  return (
    <li className="group flex items-start gap-2 p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer" onClick={onDetail}>
      {/* 완료 체크 */}
      <button
        onClick={(e) => { e.stopPropagation(); onToggle() }}
        className={cn(
          'flex-shrink-0 mt-0.5 w-4 h-4 rounded border-2 flex items-center justify-center transition-colors',
          plan.isCompleted
            ? 'border-transparent'
            : 'border-gray-300 dark:border-gray-600 hover:border-violet-400'
        )}
        style={plan.isCompleted ? { backgroundColor: plan.color } : {}}
      >
        {plan.isCompleted && <Check size={10} className="text-white" />}
      </button>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: plan.color }} />
          <span className={cn('text-sm text-gray-800 dark:text-gray-200 truncate', plan.isCompleted && 'line-through text-gray-400')}>
            {plan.title}
          </span>
        </div>

        {/* 시간 */}
        {!plan.isAllDay && plan.startTime && (
          <p className="text-xs text-gray-400 mt-0.5 ml-3.5">
            {plan.startTime.slice(0, 5)}{plan.endTime ? ` ~ ${plan.endTime.slice(0, 5)}` : ''}
          </p>
        )}

        {/* 범위 날짜 */}
        {isRange && (
          <p className="text-xs text-gray-400 mt-0.5 ml-3.5">
            {plan.startDate} ~ {plan.endDate}
          </p>
        )}

        {/* 반복 */}
        {plan.repeatType && (
          <p className="text-xs text-violet-400 mt-0.5 ml-3.5">
            {repeatLabel[plan.repeatType]}
          </p>
        )}
      </div>

      {/* 수정/삭제 버튼 */}
      <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-all">
        <button
          onClick={(e) => { e.stopPropagation(); onEdit() }}
          className="p-0.5 rounded text-gray-400 hover:text-violet-500 transition-colors"
        >
          <Pencil size={12} />
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          className="p-0.5 rounded text-gray-400 hover:text-red-500 transition-colors"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </li>
  )
}
