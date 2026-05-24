'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { X, Bookmark, BookmarkCheck, Link2, ChevronDown, ChevronUp, Search, Clock, Paperclip, Target } from 'lucide-react'
import { cn } from '@/lib/utils'
import { usePlanner } from '@/hooks/usePlanner'
import { useMemoStore } from '@/store/memoStore'
import { createClient } from '@/lib/supabase/client'
import TimePicker from './TimePicker'
import {
  type RepeatPreset, type EndMode, type CustomFreq,
  type RecurrenceSettings,
  defaultRecurrence, buildRRule, parseRRule, ALL_BYDAY,
} from '@/lib/planner/rrulePresets'
import type { Plan, PlanTemplate } from '@/types'

const PRESET_COLORS = [
  '#7C3AED', '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#EC4899',
]

const PRESET_CHIPS: { value: RepeatPreset; label: string }[] = [
  { value: 'none',          label: '반복 없음' },
  { value: 'daily',         label: '매일' },
  { value: 'weekdays',      label: '평일만' },
  { value: 'weekly',        label: '매주 같은 요일' },
  { value: 'biweekly',      label: '격주' },
  { value: 'monthly-date',  label: '매월 같은 날' },
  { value: 'monthly-day',   label: '매월 같은 요일' },
  { value: 'yearly',        label: '매년' },
  { value: 'custom',        label: '맞춤' },
]

const WEEKDAY_LABELS: { code: string; label: string }[] = [
  { code: 'MO', label: '월' }, { code: 'TU', label: '화' }, { code: 'WE', label: '수' },
  { code: 'TH', label: '목' }, { code: 'FR', label: '금' }, { code: 'SA', label: '토' }, { code: 'SU', label: '일' },
]

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
  const [singleDate, setSingleDate]   = useState(plan?.date ?? date)
  const [startDate, setStartDate]     = useState(plan?.startDate ?? date)
  const [endDate, setEndDate]         = useState(plan?.endDate ?? date)
  const [startTime, setStartTime]     = useState(plan?.startTime?.slice(0, 5) ?? initialStartTime ?? '09:00')
  const [endTime, setEndTime]         = useState(plan?.endTime?.slice(0, 5) ?? '10:00')
  const [isAllDay, setIsAllDay]       = useState(plan ? (plan.isAllDay ?? true) : !initialStartTime)
  // 반복 설정 — RRULE 기반 (preset + 종료 조건 + 맞춤 옵션)
  const [recurrence, setRecurrence] = useState<RecurrenceSettings>(() => {
    const baseDate = plan?.date ?? plan?.startDate ?? date
    if (plan?.rruleStr) {
      return parseRRule(plan.rruleStr, baseDate)
    }
    // legacy repeat_type → preset 매핑
    if (plan?.repeatType) {
      const init = defaultRecurrence()
      if (plan.repeatType === 'daily') init.preset = 'daily'
      else if (plan.repeatType === 'weekly') init.preset = 'weekly'
      else if (plan.repeatType === 'monthly') init.preset = 'monthly-date'
      if (plan.repeatEndDate) {
        init.endMode = 'until'
        init.endUntil = plan.repeatEndDate
      }
      return init
    }
    return defaultRecurrence()
  })
  const [ddayTarget, setDdayTarget]   = useState<string | null>(plan?.ddayTarget ?? null)
  const [linkedMemoIds, setLinkedMemoIds] = useState<string[]>(plan?.linkedMemoIds ?? [])
  const [showMemoPopup, setShowMemoPopup] = useState(false)
  const [memoSearch, setMemoSearch] = useState('')
  const [showTemplateDropdown, setShowTemplateDropdown] = useState(false)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const [showAdvanced, setShowAdvanced]   = useState(!!(plan?.description || plan?.repeatType || plan?.rruleStr || plan?.ddayTarget))
  const [templates, setTemplates]         = useState<PlanTemplate[]>([])
  const [loading, setLoading]             = useState(false)
  const [error, setError]                 = useState('')

  const activeMemos = memos.filter((m) => !m.isDeleted && !m.isLocked)

  // 제목 입력 시 자동완성 드롭다운용 (제목 포함 매칭)
  const matchingTemplates = useMemo(() => {
    const q = title.trim().toLowerCase()
    if (!q) return []
    return templates.filter((t) => t.title.toLowerCase().includes(q))
  }, [templates, title])

  // 검색어 기반 필터링 + 연결된 메모 상단 고정
  const filteredMemos = useMemo(() => {
    const q = memoSearch.trim().toLowerCase()
    let list = activeMemos

    if (q) {
      if (q.startsWith('#')) {
        const tagQ = q.slice(1)
        list = activeMemos.filter((m) => m.tags.some((t) => t.toLowerCase().includes(tagQ)))
      } else if (q.startsWith('[[')) {
        const wikiQ = q.slice(2)
        list = activeMemos.filter((m) => m.wikiLinks.some((w) => w.toLowerCase().includes(wikiQ)))
      } else {
        list = activeMemos.filter((m) =>
          m.title.toLowerCase().includes(q) ||
          m.contentText.toLowerCase().includes(q) ||
          m.tags.some((t) => t.toLowerCase().includes(q)) ||
          m.wikiLinks.some((w) => w.toLowerCase().includes(q))
        )
      }
    }

    return [...list].sort((a, b) => {
      const aL = linkedMemoIds.includes(a.id)
      const bL = linkedMemoIds.includes(b.id)
      return aL === bL ? 0 : aL ? -1 : 1
    })
  }, [activeMemos, memoSearch, linkedMemoIds])

  // 검색 결과 행에 표시할 매칭 힌트 (태그 / 위키)
  function getMemoHint(m: typeof activeMemos[0], q: string) {
    if (!q) return null
    const isTagMode  = q.startsWith('#')
    const isWikiMode = q.startsWith('[[')
    const tagQ  = isTagMode  ? q.slice(1)  : q
    const wikiQ = isWikiMode ? q.slice(2)  : q

    if (!isWikiMode) {
      const tag = m.tags.find((t) => t.toLowerCase().includes(tagQ))
      if (tag) return { type: 'tag' as const, value: tag }
    }
    if (!isTagMode) {
      const wiki = m.wikiLinks.find((w) => w.toLowerCase().includes(wikiQ))
      if (wiki) return { type: 'wiki' as const, value: wiki }
    }
    return null
  }

  useEffect(() => {
    supabase
      .from('plan_templates')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (data) setTemplates(data.map((r) => ({
          id: r.id,
          userId: r.user_id,
          title: r.title,
          color: r.color,
          startTime: r.start_time ?? null,
          endTime: r.end_time ?? null,
          isAllDay: r.is_all_day ?? true,
          linkedMemoIds: r.linked_memo_ids ?? [],
        })))
      })
  }, [])

  async function handleSaveTemplate() {
    if (!title.trim()) return
    const { data: { user } } = await supabase.auth.getUser()
    const { data } = await supabase
      .from('plan_templates')
      .insert({
        user_id: user?.id,
        title: title.trim(),
        color,
        start_time: isAllDay ? null : (startTime || null),
        end_time: isAllDay ? null : (endTime || null),
        is_all_day: isAllDay,
        linked_memo_ids: linkedMemoIds,
      })
      .select().single()
    if (data) setTemplates((prev) => [{
      id: data.id,
      userId: data.user_id,
      title: data.title,
      color: data.color,
      startTime: data.start_time ?? null,
      endTime: data.end_time ?? null,
      isAllDay: data.is_all_day ?? true,
      linkedMemoIds: data.linked_memo_ids ?? [],
    }, ...prev])
  }

  async function handleDeleteTemplate(id: string) {
    await supabase.from('plan_templates').delete().eq('id', id)
    setTemplates((prev) => prev.filter((t) => t.id !== id))
  }

  function applyTemplate(t: PlanTemplate) {
    setTitle(t.title)
    setColor(t.color)
    setIsAllDay(t.isAllDay)
    if (!t.isAllDay) {
      if (t.startTime) setStartTime(t.startTime.slice(0, 5))
      if (t.endTime)   setEndTime(t.endTime.slice(0, 5))
    }
    if (t.linkedMemoIds.length > 0) {
      setLinkedMemoIds(t.linkedMemoIds)
      setShowAdvanced(true)
    }
    setShowTemplateDropdown(false)
    titleInputRef.current?.blur()
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
      const baseDate = isRange ? startDate : singleDate
      const rruleStr = buildRRule(recurrence, baseDate)
      const data: Partial<Plan> = {
        title: title.trim(),
        description: description.trim(),
        color,
        isAllDay,
        date: isRange ? null : singleDate,
        startDate: isRange ? startDate : null,
        endDate: isRange ? endDate : null,
        startTime: isAllDay ? null : (startTime || null),
        endTime: isAllDay ? null : (endTime || null),
        // 새 데이터는 항상 RRULE 사용 — repeat_type은 null로 명시
        rruleStr,
        repeatType: null,
        repeatEndDate: recurrence.endMode === 'until' ? recurrence.endUntil : null,
        ddayTarget,
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
          {/* 즐겨찾기 템플릿 (최대 3개 칩 표시) */}
          {templates.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">즐겨찾기</p>
              <div className="flex gap-1.5 flex-wrap items-center">
                {templates.slice(0, 3).map((t) => (
                  <div key={t.id} className="group relative flex items-center">
                    <button
                      type="button"
                      onClick={() => applyTemplate(t)}
                      className="flex items-center gap-1 pl-2 pr-1 py-1 text-xs rounded-lg border border-gray-200 dark:border-gray-700 hover:border-violet-400 text-gray-600 dark:text-gray-300 transition-colors"
                      style={{ borderLeftColor: t.color, borderLeftWidth: 3 }}
                    >
                      <span>{t.title}</span>
                      {!t.isAllDay && t.startTime && (
                        <span className="text-gray-400 ml-0.5">{t.startTime.slice(0,5)}</span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteTemplate(t.id)}
                      className="absolute -top-1.5 -right-1.5 hidden group-hover:flex items-center justify-center w-4 h-4 bg-gray-500 text-white rounded-full text-[10px] leading-none"
                    >×</button>
                  </div>
                ))}
                {templates.length > 3 && (
                  <span className="text-[11px] text-gray-400 dark:text-gray-500">
                    +{templates.length - 3}개 · 제목 입력 시 자동완성
                  </span>
                )}
              </div>
            </div>
          )}

          {/* 제목 + 즐겨찾기 저장 + 자동완성 드롭다운 */}
          <div className="relative">
            <input
              ref={titleInputRef}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onFocus={() => setShowTemplateDropdown(true)}
              onBlur={() => setTimeout(() => setShowTemplateDropdown(false), 150)}
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

            {/* 자동완성 드롭다운 */}
            {showTemplateDropdown && matchingTemplates.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-1 z-20 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg overflow-hidden">
                {matchingTemplates.slice(0, 5).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); applyTemplate(t) }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-violet-50 dark:hover:bg-violet-950/20 border-b border-gray-100 dark:border-gray-800 last:border-0 transition-colors"
                  >
                    <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: t.color }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">{t.title}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {!t.isAllDay && t.startTime ? (
                          <span className="flex items-center gap-0.5 text-[11px] text-gray-400">
                            <Clock size={10} />
                            {t.startTime.slice(0,5)}{t.endTime ? `~${t.endTime.slice(0,5)}` : ''}
                          </span>
                        ) : (
                          <span className="text-[11px] text-gray-400">종일</span>
                        )}
                        {t.linkedMemoIds.length > 0 && (
                          <span className="flex items-center gap-0.5 text-[11px] text-gray-400">
                            <Paperclip size={10} />
                            메모 {t.linkedMemoIds.length}개
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
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
              <input type="date" value={singleDate} onChange={(e) => setSingleDate(e.target.value)}
                className="w-full px-2.5 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-violet-500" />
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
            {showAdvanced ? '고급 설정 접기' : '고급 설정 (설명, 반복, D-day, 메모 연결)'}
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
                  {PRESET_CHIPS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => setRecurrence((r) => ({ ...r, preset: opt.value }))}
                      className={cn(
                        'px-2.5 py-1 text-xs rounded-lg border transition-colors',
                        recurrence.preset === opt.value
                          ? 'border-violet-500 bg-violet-50 dark:bg-violet-950/30 text-violet-600 dark:text-violet-400'
                          : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300'
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {/* 맞춤 빌더 — preset === 'custom'일 때만 */}
                {recurrence.preset === 'custom' && (
                  <div className="mt-3 p-3 rounded-lg border border-violet-200 dark:border-violet-900/50 bg-violet-50/30 dark:bg-violet-950/10 space-y-2.5">
                    {/* 단위 */}
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-medium text-gray-500 w-10 flex-shrink-0">단위</span>
                      <div className="flex gap-1">
                        {(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as CustomFreq[]).map((f) => (
                          <button
                            key={f}
                            type="button"
                            onClick={() => setRecurrence((r) => ({ ...r, custom: { ...r.custom, freq: f } }))}
                            className={cn(
                              'px-2 py-0.5 text-[11px] rounded border transition-colors',
                              recurrence.custom.freq === f
                                ? 'border-violet-500 bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-400'
                                : 'border-gray-200 dark:border-gray-700 text-gray-500',
                            )}
                          >
                            {({ DAILY: '일', WEEKLY: '주', MONTHLY: '월', YEARLY: '년' } as const)[f]}
                          </button>
                        ))}
                      </div>
                    </div>
                    {/* 간격 */}
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-medium text-gray-500 w-10 flex-shrink-0">간격</span>
                      <input
                        type="number"
                        min={1}
                        max={365}
                        value={recurrence.custom.interval}
                        onChange={(e) => setRecurrence((r) => ({ ...r, custom: { ...r.custom, interval: Math.max(1, parseInt(e.target.value, 10) || 1) } }))}
                        className="w-14 px-2 py-0.5 text-[11px] rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-center"
                      />
                      <span className="text-[11px] text-gray-500">
                        {({ DAILY: '일', WEEKLY: '주', MONTHLY: '월', YEARLY: '년' } as const)[recurrence.custom.freq]}마다
                      </span>
                    </div>
                    {/* 요일 다중 — WEEKLY일 때만 */}
                    {recurrence.custom.freq === 'WEEKLY' && (
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] font-medium text-gray-500 w-10 flex-shrink-0">요일</span>
                        <div className="flex gap-1 flex-wrap">
                          {WEEKDAY_LABELS.map((wd) => {
                            const selected = recurrence.custom.byday.includes(wd.code)
                            return (
                              <button
                                key={wd.code}
                                type="button"
                                onClick={() => setRecurrence((r) => ({
                                  ...r,
                                  custom: {
                                    ...r.custom,
                                    byday: selected
                                      ? r.custom.byday.filter((b) => b !== wd.code)
                                      : [...r.custom.byday, wd.code],
                                  },
                                }))}
                                className={cn(
                                  'w-6 h-6 text-[10px] rounded-full transition-colors',
                                  selected
                                    ? 'bg-violet-600 text-white'
                                    : 'bg-gray-100 dark:bg-gray-800 text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700',
                                )}
                              >
                                {wd.label}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* 종료 조건 — 반복이 있는 경우만 */}
                {recurrence.preset !== 'none' && (
                  <div className="mt-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/30 space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-medium text-gray-500 w-10 flex-shrink-0">종료</span>
                      <div className="flex gap-1">
                        {(['forever', 'count', 'until'] as EndMode[]).map((m) => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => setRecurrence((r) => ({ ...r, endMode: m }))}
                            className={cn(
                              'px-2 py-0.5 text-[11px] rounded border transition-colors',
                              recurrence.endMode === m
                                ? 'border-violet-500 bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-400'
                                : 'border-gray-200 dark:border-gray-700 text-gray-500',
                            )}
                          >
                            {({ forever: '끝없음', count: '횟수', until: '날짜' } as const)[m]}
                          </button>
                        ))}
                      </div>
                    </div>
                    {recurrence.endMode === 'count' && (
                      <div className="flex items-center gap-2 pl-12">
                        <input
                          type="number"
                          min={1}
                          max={500}
                          value={recurrence.endCount}
                          onChange={(e) => setRecurrence((r) => ({ ...r, endCount: Math.max(1, parseInt(e.target.value, 10) || 1) }))}
                          className="w-14 px-2 py-0.5 text-[11px] rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-center"
                        />
                        <span className="text-[11px] text-gray-500">회 반복 후 종료</span>
                      </div>
                    )}
                    {recurrence.endMode === 'until' && (
                      <div className="flex items-center gap-2 pl-12">
                        <input
                          type="date"
                          value={recurrence.endUntil ?? ''}
                          min={isRange ? startDate : singleDate}
                          onChange={(e) => setRecurrence((r) => ({ ...r, endUntil: e.target.value || null }))}
                          className="px-2 py-0.5 text-[11px] rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"
                        />
                        <span className="text-[11px] text-gray-500">까지 반복</span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* D-day */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                    <Target size={11} className="text-rose-500" /> D-day
                  </p>
                  {ddayTarget && (
                    <button
                      type="button"
                      onClick={() => setDdayTarget(null)}
                      className="text-[11px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                    >
                      해제
                    </button>
                  )}
                </div>
                {ddayTarget ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="date"
                      value={ddayTarget}
                      onChange={(e) => setDdayTarget(e.target.value || null)}
                      className="flex-1 px-2.5 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-rose-500"
                    />
                    <span className="text-xs font-medium text-rose-500 whitespace-nowrap">
                      {(() => {
                        const today = new Date(); today.setHours(0, 0, 0, 0)
                        const t = new Date(ddayTarget); t.setHours(0, 0, 0, 0)
                        const diff = Math.round((t.getTime() - today.getTime()) / 86400000)
                        if (diff > 0) return `D-${diff}`
                        if (diff === 0) return 'D-Day'
                        return `D+${-diff}`
                      })()}
                    </span>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setDdayTarget(singleDate)}
                    className="w-full px-3 py-2 text-xs text-rose-500 border border-dashed border-rose-200 dark:border-rose-900/50 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/20 transition-colors"
                  >
                    + 목표일 지정 (홈 화면에 카운트다운 표시)
                  </button>
                )}
              </div>

              {/* 메모 연결 */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-xs font-medium text-gray-500 dark:text-gray-400">메모 연결</p>
                  <button
                    type="button"
                    onClick={() => {
                      const next = !showMemoPopup
                      setShowMemoPopup(next)
                      if (!next) setMemoSearch('')
                    }}
                    className="flex items-center gap-1 text-xs text-violet-600 dark:text-violet-400 hover:underline"
                  >
                    <Link2 size={11} />
                    {linkedMemoIds.length > 0 ? `${linkedMemoIds.length}개 연결됨` : '메모 선택'}
                  </button>
                </div>

                {showMemoPopup && (
                  <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                    {/* 검색 입력 */}
                    <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                      <Search size={12} className="text-gray-400 flex-shrink-0" />
                      <input
                        type="text"
                        value={memoSearch}
                        onChange={(e) => setMemoSearch(e.target.value)}
                        placeholder="제목 · 내용 · #태그 · [[위키"
                        className="flex-1 text-xs bg-transparent outline-none text-gray-700 dark:text-gray-300 placeholder-gray-400 dark:placeholder-gray-500"
                        autoComplete="off"
                      />
                      {memoSearch && (
                        <button type="button" onClick={() => setMemoSearch('')} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 flex-shrink-0">
                          <X size={11} />
                        </button>
                      )}
                    </div>

                    {/* 메모 목록 */}
                    <div className="max-h-48 overflow-y-auto">
                      {filteredMemos.length === 0 ? (
                        <p className="text-xs text-gray-400 text-center py-4">
                          {memoSearch ? '검색 결과가 없습니다' : '연결할 메모가 없습니다'}
                        </p>
                      ) : (
                        filteredMemos.map((m) => {
                          const linked = linkedMemoIds.includes(m.id)
                          const hint = getMemoHint(m, memoSearch.trim().toLowerCase())
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
                              {linked
                                ? <BookmarkCheck size={11} className="text-violet-500 flex-shrink-0" />
                                : <Bookmark size={11} className="text-gray-400 flex-shrink-0" />}
                              <span className="truncate flex-1">{m.title || '제목 없음'}</span>
                              {hint && (
                                <span className={cn(
                                  'flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded',
                                  hint.type === 'tag'
                                    ? 'bg-blue-50 dark:bg-blue-950/30 text-blue-500 dark:text-blue-400'
                                    : 'bg-green-50 dark:bg-green-950/30 text-green-600 dark:text-green-400'
                                )}>
                                  {hint.type === 'tag' ? `#${hint.value}` : `[[${hint.value}]]`}
                                </span>
                              )}
                            </button>
                          )
                        })
                      )}
                    </div>
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
