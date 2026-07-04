'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { X, Pencil, Trash2, Check, Calendar, Clock, RepeatIcon, FileText, Target, BookmarkPlus, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { format, parseISO } from 'date-fns'
import { ko } from 'date-fns/locale'
import { cn } from '@/lib/utils'
import { useMemos } from '@/hooks/useMemos'
import { usePlannerStore } from '@/store/plannerStore'
import { usePlanner } from '@/hooks/usePlanner'
import { describeRRule } from '@/lib/planner/rrulePresets'
import { useConfirm } from '@/components/ui/ConfirmModal'
import type { Plan } from '@/types'

interface PlanDetailPanelProps {
  plan: Plan
  onEdit: () => void
  onDelete?: (mode: 'this' | 'after' | 'all') => void
  onClose: () => void
}

const REPEAT_LABEL: Record<string, string> = {
  daily: '매일 반복',
  weekly: '매주 반복',
  monthly: '매월 반복',
}

export default function PlanDetailPanel({ plan, onEdit, onDelete, onClose }: PlanDetailPanelProps) {
  const router = useRouter()
  const { memos } = useMemos(undefined) // React Query 단일 출처 (연결 메모 표시)
  const { toggleComplete, removePlan, toggleRecurringComplete, skipRecurringInstance, stopRecurringFromDate } = usePlanner()
  const [showDeleteMenu, setShowDeleteMenu] = useState(false)
  const [tplSaveState, setTplSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const supabase = createClient()
  const confirm = useConfirm()

  /** 현재 플랜을 새 템플릿으로 저장 — 색/시간/반복/알림/설명 모두 복사 */
  async function saveAsTemplate() {
    if (tplSaveState === 'saving') return
    setTplSaveState('saving')
    try {
      const { data: { session } } = await supabase.auth.getSession(); const user = session?.user ?? null
      if (!user) throw new Error('로그인 필요')
      await supabase.from('plan_templates').insert({
        user_id: user.id,
        title: plan.title,
        color: plan.color,
        start_time: plan.isAllDay ? null : (plan.startTime || null),
        end_time:   plan.isAllDay ? null : (plan.endTime   || null),
        is_all_day: plan.isAllDay,
        linked_memo_ids: plan.linkedMemoIds ?? [],
        description: plan.description?.trim() || null,
        rrule_str: plan.rruleStr ?? null,
        notify_enabled: plan.notifyEnabled ?? false,
        notify_lead_min: plan.notifyLeadMin ?? 10,
      })
      setTplSaveState('saved')
      setTimeout(() => setTplSaveState('idle'), 1500)
    } catch (e) {
      console.error('[saveAsTemplate]', e)
      setTplSaveState('idle')
    }
  }

  // store 직접 구독 — props로 받은 plan은 stale일 수 있음
  const recurringCompletions = usePlannerStore((s) => s.recurringCompletions)
  const storedPlans = usePlannerStore((s) => s.plans)

  // isCompleted는 store 기반으로 항상 최신값 사용
  const isCompleted = useMemo(() => {
    if (plan.isRecurringInstance && plan.originalPlanId && plan.date) {
      const key = `${plan.originalPlanId}_${plan.date}`
      return recurringCompletions[key] === true
    }
    const stored = storedPlans.find((p) => p.id === plan.id)
    return stored ? stored.isCompleted : plan.isCompleted
  }, [plan, storedPlans, recurringCompletions])

  const linkedMemos = (plan.linkedMemoIds ?? [])
    .map((id) => memos.find((m) => m.id === id))
    .filter(Boolean)

  function handleDelete() {
    if (onDelete) {
      // PlanPanel이 모달 처리
      onDelete('all')
      return
    }
    if (plan.isRecurringInstance) {
      setShowDeleteMenu(true)
    } else {
      confirm.open({
        title: '플랜을 삭제할까요?',
        description: '삭제한 플랜은 되돌릴 수 없어요.',
        variant: 'danger',
        confirmLabel: '삭제',
        onConfirm: async () => {
          await removePlan(plan.id)
          onClose()
        },
      })
    }
  }

  function handleToggleComplete() {
    // isCompleted (fresh) 기준으로 토글 — props plan.isCompleted는 stale 가능
    if (plan.isRecurringInstance && plan.originalPlanId && plan.date) {
      toggleRecurringComplete(plan.originalPlanId, plan.date, isCompleted).catch(console.error)
    } else {
      toggleComplete(plan.id, isCompleted).catch(console.error)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div
        className="relative w-full max-w-sm h-full bg-white dark:bg-gray-900 shadow-2xl flex flex-col overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-2.5">
            <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: plan.color }} />
            <h2 className={cn('text-sm font-semibold text-gray-900 dark:text-white', isCompleted && 'line-through text-gray-400')}>
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
            onClick={handleToggleComplete}
            className={cn(
              'flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150 border',
              isCompleted
                ? 'bg-emerald-500 dark:bg-emerald-600 border-emerald-500 dark:border-emerald-600 text-white shadow-sm hover:bg-emerald-600 dark:hover:bg-emerald-700'
                : 'bg-gray-100 dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
            )}
          >
            <Check size={13} className={isCompleted ? 'text-white' : 'text-gray-400'} />
            {isCompleted ? '완료됨 (다시 누르면 해제)' : '완료 표시'}
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

          {/* D-day */}
          {plan.ddayTarget && (() => {
            const today = new Date(); today.setHours(0, 0, 0, 0)
            const target = new Date(plan.ddayTarget); target.setHours(0, 0, 0, 0)
            const diff = Math.round((target.getTime() - today.getTime()) / 86400000)
            const label = diff > 0 ? `D-${diff}` : diff === 0 ? 'D-Day' : `D+${-diff}`
            const tone =
              diff < 0
                ? 'text-gray-400'
                : diff <= 3
                  ? 'text-rose-600 dark:text-rose-400'
                  : diff <= 7
                    ? 'text-amber-600 dark:text-amber-400'
                    : 'text-rose-500 dark:text-rose-400'
            return (
              <div className="flex items-center gap-3">
                <Target size={15} className="text-rose-400 flex-shrink-0" />
                <span className={cn('text-sm font-semibold', tone)}>
                  {label}
                </span>
                <span className="text-xs text-gray-400">
                  ({format(parseISO(plan.ddayTarget), 'yyyy년 M월 d일', { locale: ko })})
                </span>
              </div>
            )
          })()}

          {/* 반복 */}
          {(plan.rruleStr || plan.repeatType || plan.isRecurringInstance) && (
            <div className="flex items-start gap-3">
              <RepeatIcon size={15} className="text-violet-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <span className="text-sm text-violet-600 dark:text-violet-400">
                  {plan.rruleStr
                    ? describeRRule(plan.rruleStr, plan.date ?? plan.startDate)
                    : plan.repeatType
                      ? REPEAT_LABEL[plan.repeatType]
                      : '반복 일정'}
                </span>
                {plan.isRecurringInstance && (
                  <span className="ml-1.5 text-xs bg-violet-100 dark:bg-violet-950/30 text-violet-500 px-1.5 py-0.5 rounded">인스턴스</span>
                )}
              </div>
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
            onClick={saveAsTemplate}
            disabled={tplSaveState !== 'idle'}
            title="이 플랜을 템플릿으로 저장"
            className={cn(
              'flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg transition-colors',
              tplSaveState === 'saved'
                ? 'bg-emerald-50 dark:bg-emerald-950/20 text-emerald-600'
                : 'bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 disabled:opacity-60'
            )}
          >
            {tplSaveState === 'saving'
              ? <Loader2 size={13} className="animate-spin" />
              : tplSaveState === 'saved'
                ? <Check size={13} />
                : <BookmarkPlus size={13} />}
          </button>
          <button
            onClick={handleDelete}
            className="flex items-center justify-center gap-1.5 px-4 py-2 bg-red-50 dark:bg-red-950/20 hover:bg-red-100 dark:hover:bg-red-950/40 text-red-500 text-sm font-medium rounded-lg transition-colors"
          >
            <Trash2 size={13} />
          </button>
        </div>

        {/* 반복 삭제 메뉴 */}
        {showDeleteMenu && (
          <div className="absolute inset-0 flex items-end justify-center bg-black/30 rounded-r-none z-10" onClick={() => setShowDeleteMenu(false)}>
            <div className="w-full bg-white dark:bg-gray-900 rounded-t-xl p-4 space-y-2 shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <p className="text-xs font-medium text-gray-500 mb-3">반복 일정 삭제</p>
              <button className="w-full text-left px-3 py-2.5 text-sm rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300"
                onClick={() => { skipRecurringInstance(plan.originalPlanId!, plan.date!).catch(console.error); setShowDeleteMenu(false); onClose() }}>
                이 일정만 삭제
              </button>
              <button className="w-full text-left px-3 py-2.5 text-sm rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300"
                onClick={() => { stopRecurringFromDate(plan.originalPlanId!, plan.date!).catch(console.error); setShowDeleteMenu(false); onClose() }}>
                이 일정부터 반복 종료
              </button>
              <button className="w-full text-left px-3 py-2.5 text-sm rounded-lg hover:bg-red-50 dark:hover:bg-red-950/20 text-red-500"
                onClick={() => { removePlan(plan.originalPlanId!).catch(console.error); setShowDeleteMenu(false); onClose() }}>
                모든 반복 일정 삭제
              </button>
              <button className="w-full py-2.5 text-sm rounded-lg bg-gray-100 dark:bg-gray-800 text-gray-500 mt-1" onClick={() => setShowDeleteMenu(false)}>
                취소
              </button>
            </div>
          </div>
        )}
      </div>
      <confirm.Render />
    </div>
  )
}
