'use client'

import { useState, useEffect } from 'react'
import { X, Bookmark, BookmarkCheck, Link2, ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import { usePlanner } from '@/hooks/usePlanner'
import { useMemoStore } from '@/store/memoStore'
import { createClient } from '@/lib/supabase/client'
import TimePicker from './TimePicker'
import type { Plan, PlanTemplate } from '@/types'

const PRESET_COLORS = [
  '#7C3AED', '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#EC4899',
]

const REPEAT_OPTIONS = [
  { value: null,      label: '반복 없음' },
  { value: 'daily',   label: '매일' },
  { value: 'weekly',  label: '매주' },
  { value: 'monthly', label: '매월' },
] as const

interface PlanFormModalProps {
  date: string
  plan?: Plan
  initialStartTime?: string
  onClose: () => void
  onSaved: () => void
}

export default function PlanFormModal({ date, plan, initialStartTime, onClose, onSaved }: PlanFormModalProps) {
  const { createPlan, editPlan } = usePlanner()
  const { memos } = useMemoStore()
  const supabase = createClient()

  const [title, setTitle]             = useState(plan?.title ?? '')
  const [description, setDescription] = useState(plan?.description ?? '')
  const [color, setColor]             = useState(plan?.color ?? '#7C3AED')
  const [isRange, setIsRange]         = useState(!!(plan?.startDate))
  const [startDate, setStartDate]     = useState(plan?.startDate ?? date)
  const [endDate, setEndDate]         = useState(plan?.endDate ?? date)
  const [startTime, setStartTime]     = useState(plan?.startTime?.slice(0, 5) ?? initialStartTime ?? '09:00')
  const [endTime, setEndTime]         = useState(plan?.endTime?.slice(0, 5) ?? '10:00')
  const [isAllDay, setIsAllDay]       = useState(plan ? (plan.isAllDay ?? true) : !initialStartTime)
  const [repeatType, setRepeatType]   = useState<'daily' | 'weekly' | 'monthly' | null>(plan?.repeatType ?? null)
  const [linkedMemoIds, setLinkedMemoIds] = useState<string[]>(plan?.linkedMemoIds ?? [])
  const [showMemoPopup, setShowMemoPopup] = useState(false)
  const [showAdvanced, setShowAdvanced]   = useState(!!(plan?.description || plan?.repeatType))
  const [templates, setTemplates]         = useState<PlanTemplate[]>([])
  const [loading, setLoading]             = useState(false)
  const [error, setError]                 = useState('')

  const activeMemos = memos.filter((m) => !m.isDeleted && !m.isLocked)

  useEffect(() => {
    supabase
      .from('plan_templates')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (data) setTemplates(data.map((r) => ({ id: r.id, userId: r.user_id, title: r.title, color: r.color })))
      })
  }, [])

  async function handleSaveTemplate() {
    if (!title.trim()) return
    const { data: { user } } = await supabase.auth.getUser()
    const { data } = await supabase
      .from('plan_templates')
      .insert({ user_id: user?.id, title: title.trim(), color })
      .select().single()
    if (data) setTemplates((prev) => [{ id: data.id, userId: data.user_id, title: data.title, color: data.color }, ...prev])
  }

  async function handleDeleteTemplate(id: string) {
    await supabase.from('plan_templates').delete().eq('id', id)
    setTemplates((prev) => prev.filter((t) => t.id !== id))
  }

  function applyTemplate(t: PlanTemplate) {
    setTitle(t.title)
    setColor(t.color)
  }

  function toggleMemo(id: string) {
    setLinkedMemoIds((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
    )
  }

  function calcDuration(s: string, e: string): string {
    const [sh, sm] = s.split(':').map(Number)
    const [eh, em] = e.split(':').map(Number)
    const diff = (eh * 60 + em) - (sh * 60 + sm)
    if (diff <= 0) return ''
    const h = Math.floor(diff / 60), m = diff % 60
    if (m === 0) return `${h}시간`
    if (h === 0) return `${m}분`
    return `${h}시간 ${m}분`
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) { setError('제목을 입력하세요.'); return }
    if (!isAllDay) {
      const [sh, sm] = startTime.split(':').map(Number)
      const [eh, em] = endTime.split(':').map(Number)
      if (eh * 60 + em <= sh * 60 + sm) {
        setError('종료 시간은 시작 시간보다 늦어야 해요.')
        return
      }
    }
    setLoading(true)
    try {
      const data: Partial<Plan> = {
        title: title.trim(),
        description: description.trim(),
        color,
        isAllDay,
        date: isRange ? null : date,
        startDate: isRange ? startDate : null,
        endDate: isRange ? endDate : null,
        startTime: isAllDay ? null : (startTime || null),
        endTime: isAllDay ? null : (endTime || null),
        repeatType,
        linkedMemoIds,
      }
      if (plan) {
        await editPlan(plan.id, data)
      } else {
        await createPlan(data)
      }
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장 중 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:w-[420px] max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-gray-100 dark:border-gray-800">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
            {plan ? '플랜 수정' : '새 플랜'}
          </h3>
          <button onClick={onClose} className="p-1 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800">
            <X size={15} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
          {/* 즐겨찾기 템플릿 */}
          {templates.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">즐겨찾기</p>
              <div className="flex gap-1.5 flex-wrap">
                {templates.map((t) => (
                  <div key={t.id} className="group relative flex items-center">
                    <button
                      type="button"
                      onClick={() => applyTemplate(t)}
                      className="flex items-center gap-1 pl-2 pr-1 py-1 text-xs rounded-lg border border-gray-200 dark:border-gray-700 hover:border-violet-400 text-gray-600 dark:text-gray-300 transition-colors"
                      style={{ borderLeftColor: t.color, borderLeftWidth: 3 }}
                    >
                      {t.title}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteTemplate(t.id)}
                      className="absolute -top-1.5 -right-1.5 hidden group-hover:flex items-center justify-center w-4 h-4 bg-gray-500 text-white rounded-full text-[10px] leading-none"
                    >×</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 제목 + 즐겨찾기 저장 */}
          <div className="relative">
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="플랜 제목"
              autoFocus
              className="w-full pl-3.5 pr-10 py-2.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
            />
            <button
              type="button"
              title="즐겨찾기에 저장"
              onClick={handleSaveTemplate}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-amber-400 transition-colors"
            >
              <Bookmark size={14} />
            </button>
          </div>

          {/* 색상 */}
          <div className="flex items-center gap-2">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 w-10 flex-shrink-0">색상</p>
            <div className="flex gap-2">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={cn('w-6 h-6 rounded-full transition-transform hover:scale-110', color === c && 'ring-2 ring-offset-2 ring-gray-400 dark:ring-offset-gray-900')}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          {/* 날짜 유형 + 종일 */}
          <div className="flex items-center gap-4">
            <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400 cursor-pointer select-none">
              <input type="checkbox" checked={isRange} onChange={(e) => setIsRange(e.target.checked)} className="accent-violet-600" />
              범위 플랜
            </label>
            {/* 종일 토글 */}
            <button
              type="button"
              onClick={() => setIsAllDay((v) => !v)}
              className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400 select-none"
            >
              <span
                className={cn(
                  'relative inline-flex h-4 w-7 items-center rounded-full transition-colors',
                  isAllDay ? 'bg-violet-600' : 'bg-gray-300 dark:bg-gray-600'
                )}
              >
                <span
                  className={cn(
                    'absolute h-3 w-3 rounded-full bg-white shadow transition-transform',
                    isAllDay ? 'translate-x-3.5' : 'translate-x-0.5'
                  )}
                />
              </span>
              종일
            </button>
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

          {/* 시간 */}
          {!isAllDay && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <TimePicker label="시작 시간" value={startTime} onChange={setStartTime} />
                <TimePicker label="종료 시간" value={endTime} onChange={setEndTime} />
              </div>
              {calcDuration(startTime, endTime) && (
                <p className="text-xs text-violet-500">소요 시간: {calcDuration(startTime, endTime)}</p>
              )}
            </div>
          )}

          {/* 고급 설정 토글 */}
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            {showAdvanced ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            {showAdvanced ? '고급 설정 접기' : '고급 설정 (설명, 반복, 메모 연결)'}
          </button>

          {showAdvanced && (
            <div className="space-y-4">
              {/* 설명 */}
              <div>
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">설명</p>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="플랜에 대한 설명을 입력하세요..."
                  rows={3}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 outline-none focus:ring-2 focus:ring-violet-500 resize-none"
                />
              </div>

              {/* 반복 */}
              <div>
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">반복</p>
                <div className="flex gap-1.5 flex-wrap">
                  {REPEAT_OPTIONS.map((opt) => (
                    <button
                      key={String(opt.value)}
                      type="button"
                      onClick={() => setRepeatType(opt.value as typeof repeatType)}
                      className={cn(
                        'px-2.5 py-1 text-xs rounded-lg border transition-colors',
                        repeatType === opt.value
                          ? 'border-violet-500 bg-violet-50 dark:bg-violet-950/30 text-violet-600 dark:text-violet-400'
                          : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300'
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 메모 연결 */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400">메모 연결</p>
                  <button
                    type="button"
                    onClick={() => setShowMemoPopup((v) => !v)}
                    className="flex items-center gap-1 text-xs text-violet-600 dark:text-violet-400 hover:underline"
                  >
                    <Link2 size={11} />
                    {linkedMemoIds.length > 0 ? `${linkedMemoIds.length}개 연결됨` : '메모 선택'}
                  </button>
                </div>

                {showMemoPopup && (
                  <div className="border border-gray-200 dark:border-gray-700 rounded-lg max-h-40 overflow-y-auto">
                    {activeMemos.length === 0 ? (
                      <p className="text-xs text-gray-400 text-center py-4">연결할 메모가 없습니다</p>
                    ) : (
                      activeMemos.map((m) => {
                        const linked = linkedMemoIds.includes(m.id)
                        return (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => toggleMemo(m.id)}
                            className={cn(
                              'w-full flex items-center gap-2 px-3 py-2 text-xs text-left border-b border-gray-100 dark:border-gray-800 last:border-0 transition-colors',
                              linked
                                ? 'bg-violet-50 dark:bg-violet-950/20 text-violet-700 dark:text-violet-300'
                                : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                            )}
                          >
                            {linked ? <BookmarkCheck size={11} className="text-violet-500 flex-shrink-0" /> : <Bookmark size={11} className="text-gray-400 flex-shrink-0" />}
                            <span className="truncate">{m.title || '제목 없음'}</span>
                          </button>
                        )
                      })
                    )}
                  </div>
                )}

                {linkedMemoIds.length > 0 && !showMemoPopup && (
                  <div className="flex flex-wrap gap-1">
                    {linkedMemoIds.map((id) => {
                      const m = activeMemos.find((m) => m.id === id)
                      if (!m) return null
                      return (
                        <span key={id} className="flex items-center gap-1 px-2 py-0.5 bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-300 text-xs rounded-full border border-violet-200 dark:border-violet-800">
                          {m.title || '제목 없음'}
                          <button type="button" onClick={() => toggleMemo(id)} className="text-violet-400 hover:text-violet-600">×</button>
                        </span>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {error && <p className="text-xs text-red-500 bg-red-50 dark:bg-red-950/30 px-3 py-2 rounded-lg">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {loading ? '저장 중...' : plan ? '수정' : '추가'}
          </button>
        </form>
      </div>
    </div>
  )
}
