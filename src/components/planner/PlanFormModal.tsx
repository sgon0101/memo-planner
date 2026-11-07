'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { X, Bookmark, BookmarkCheck, Link2, ChevronDown, ChevronUp, Search, Clock, Paperclip, Bell, BellOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import { usePlanner } from '@/hooks/usePlanner'
import { useMemos } from '@/hooks/useMemos'
import { createClient } from '@/lib/supabase/client'
import Modal from '@/components/ui/Modal'
import TimePicker from './TimePicker'
import {
  type RepeatPreset, type EndMode, type CustomFreq,
  type RecurrenceSettings,
  defaultRecurrence, buildRRule, parseRRule,
} from '@/lib/planner/rrulePresets'
import { tagKey, wikiKey } from '@/lib/wiki/normalize'
import type { Plan, PlanTemplate } from '@/types'
import { deleteTemplateWithUndo } from '@/lib/planner/templateUndo'
import { reportSaveError } from '@/lib/ui/reportSaveError'
import { isInboxPlan, INBOX_RESET_FIELDS } from '@/lib/planner/inbox'
import { dedupeTemplates, upsertTemplate, rowToTemplate } from '@/lib/planner/templates'
import { toast } from '@/components/ui/Toast'

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
/** 2026-11 옵션 정리: 기본으로 보이는 반복 프리셋 (실사용 0건 → 단순화).
 *  이미 다른 프리셋(격주·맞춤 등)으로 저장된 플랜은 그 칩을 함께 보여 기존 데이터를 그대로 고칠 수 있다. */
const VISIBLE_PRESETS: RepeatPreset[] = ['none', 'daily', 'weekdays', 'weekly', 'monthly-date']

/** 색상 버튼 스크린리더 라벨 */
const COLOR_NAMES: Record<string, string> = {
  '#7C3AED': '보라', '#3B82F6': '파랑', '#10B981': '초록', '#F59E0B': '주황', '#EF4444': '빨강', '#EC4899': '분홍',
}

const WEEKDAY_LABELS: { code: string; label: string }[] = [
  { code: 'MO', label: '월' }, { code: 'TU', label: '화' }, { code: 'WE', label: '수' },
  { code: 'TH', label: '목' }, { code: 'FR', label: '금' }, { code: 'SA', label: '토' }, { code: 'SU', label: '일' },
]

interface PlanFormModalProps {
  date: string
  plan?: Plan
  initialStartTime?: string
  initialEndTime?: string
  onClose: () => void
  onSaved: () => void
}

export default function PlanFormModal({ date, plan, initialStartTime, initialEndTime, onClose, onSaved }: PlanFormModalProps) {
  const { createPlan, editPlan } = usePlanner()
  const { memos } = useMemos(undefined) // React Query 단일 출처 (연결 메모 목록)
  const supabase = createClient()

  const [title, setTitle]             = useState(plan?.title ?? '')
  const [description, setDescription] = useState(plan?.description ?? '')
  const [color, setColor]             = useState(plan?.color ?? '#7C3AED')
  // 날짜 유형 — 하루 / 기간 / 미정(인박스). 미정은 2026-11 인박스 도입으로 추가:
  // 인박스 플랜을 이 폼에서 열어 저장하면 오늘 날짜가 강제로 들어가던 문제 방지
  const [dateMode, setDateMode] = useState<'single' | 'range' | 'none'>(
    plan ? (isInboxPlan(plan) ? 'none' : plan.startDate ? 'range' : 'single') : 'single',
  )
  const isRange = dateMode === 'range'
  const isUndated = dateMode === 'none'
  const [singleDate, setSingleDate]   = useState(plan?.date ?? date)
  const [startDate, setStartDate]     = useState(plan?.startDate ?? date)
  const [endDate, setEndDate]         = useState(plan?.endDate ?? date)
  const [startTime, setStartTime]     = useState(plan?.startTime?.slice(0, 5) ?? initialStartTime ?? '09:00')
  const [endTime, setEndTime]         = useState(plan?.endTime?.slice(0, 5) ?? initialEndTime ?? '10:00')
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
  // 숫자 입력은 문자열로 따로 관리 — 사용자가 지우고 재입력 가능하게
  const [intervalStr,  setIntervalStr]  = useState(() => String(recurrence.custom?.interval ?? 1))
  const [endCountStr,  setEndCountStr]  = useState(() => String(recurrence.endCount ?? 1))
  // 기본 OFF (opt-in) — 알림 받고 싶은 플랜만 사용자가 명시적으로 켜기
  const [notifyEnabled, setNotifyEnabled] = useState<boolean>(plan?.notifyEnabled ?? false)
  // 알림 시점 — 시작 시간 N분 전 (사용자 설정 default → fallback 10)
  const [notifyLeadMin, setNotifyLeadMin] = useState<number>(() => {
    if (plan?.notifyLeadMin !== undefined && plan?.notifyLeadMin !== null) return plan.notifyLeadMin
    if (typeof window !== 'undefined') {
      const raw = localStorage.getItem('weave-notif-lead-min')
      const n = raw ? parseInt(raw, 10) : NaN
      if (!isNaN(n) && [0, 5, 10, 30, 60].includes(n)) return n
    }
    return 10
  })
  // D-day 입력은 2026-11 옵션 정리로 제거(실사용 0건). 기존 값은 수정 시 그대로 보존한다
  const [ddayTarget]   = useState<string | null>(plan?.ddayTarget ?? null)
  const [linkedMemoIds, setLinkedMemoIds] = useState<string[]>(plan?.linkedMemoIds ?? [])
  const [showMemoPopup, setShowMemoPopup] = useState(false)
  const [memoSearch, setMemoSearch] = useState('')
  const [showTemplateDropdown, setShowTemplateDropdown] = useState(false)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const [showAdvanced, setShowAdvanced]   = useState(!!(plan?.description || plan?.repeatType || plan?.rruleStr))
  const [templates, setTemplates]         = useState<PlanTemplate[]>([])
  const [loading, setLoading]             = useState(false)
  const [error, setError]                 = useState('')

  const activeMemos = memos.filter((m) => !m.isDeleted && !m.isLocked)

  // 제목 입력 시 자동완성 드롭다운용 (제목 포함 매칭)
  const matchingTemplates = useMemo(() => {
    const q = title.trim().toLowerCase()
    // 비어 있으면 자주 쓰는 즐겨찾기를 보여준다 (2026-11: 상단 칩 줄을 이 목록으로 통합)
    if (!q) return templates
    return templates.filter((t) => t.title.toLowerCase().includes(q) && t.title.trim().toLowerCase() !== q)
  }, [templates, title])

  // 검색어 기반 필터링 + 연결된 메모 상단 고정
  const filteredMemos = useMemo(() => {
    const q = memoSearch.trim().toLowerCase()
    let list = activeMemos

    if (q) {
      if (q.startsWith('#')) {
        const tagQ = tagKey(q.slice(1))
        list = activeMemos.filter((m) => m.tags.some((t) => tagKey(t).includes(tagQ)))
      } else if (q.startsWith('[[')) {
        // 정규화 키 비교 — 띄어쓴 표기로 검색해도 같은 허브의 메모가 잡힌다
        const wikiQ = wikiKey(q.slice(2))
        list = activeMemos.filter((m) => m.wikiLinks.some((w) => wikiKey(w).includes(wikiQ)))
      } else {
        list = activeMemos.filter((m) =>
          m.title.toLowerCase().includes(q) ||
          m.contentText.toLowerCase().includes(q) ||
          m.tags.some((t) => tagKey(t).includes(tagKey(q))) ||
          m.wikiLinks.some((w) => wikiKey(w).includes(wikiKey(q)))
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
      const tag = m.tags.find((t) => tagKey(t).includes(tagKey(tagQ)))
      if (tag) return { type: 'tag' as const, value: tag }
    }
    if (!isTagMode) {
      const wiki = m.wikiLinks.find((w) => wikiKey(w).includes(wikiKey(wikiQ)))
      if (wiki) return { type: 'wiki' as const, value: wiki }
    }
    return null
  }

  useEffect(() => {
    supabase
      .from('plan_templates')
      .select('*')
      // 자주 쓰는 템플릿이 위로 — use_count → last_used_at → created_at 폴백
      .order('use_count', { ascending: false })
      .order('last_used_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        // 같은 제목 중복(과거 무조건 insert로 쌓인 것)은 화면에서만 하나로 — 많이 쓴 쪽이 남는다
        if (data) setTemplates(dedupeTemplates(data.map(rowToTemplate)))
      })
    // 모달이 열릴 때 1회만 불러온다 — supabase는 렌더마다 새로 만들어지는 클라이언트라 deps에 넣으면 매 렌더 재조회
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleSaveTemplate() {
    if (!title.trim()) return
    const { data: { session } } = await supabase.auth.getSession(); const user = session?.user ?? null
    if (!user) return
    // 현재 폼의 모든 옵션을 템플릿에 함께 저장 (반복/알림/메모 포함). 같은 제목이 있으면 갱신.
    const baseDate = isRange ? startDate : singleDate
    const tplRrule = isUndated ? null : buildRRule(recurrence, baseDate)
    try {
      const { row, updated } = await upsertTemplate(supabase, user.id, {
        title: title.trim(),
        color,
        start_time: isAllDay || isUndated ? null : (startTime || null),
        end_time: isAllDay || isUndated ? null : (endTime || null),
        is_all_day: isAllDay || isUndated,
        linked_memo_ids: linkedMemoIds,
        description: description.trim() || null,
        rrule_str: tplRrule,
        notify_enabled: notifyEnabled && !isUndated,
        notify_lead_min: notifyLeadMin,
      })
      const saved = rowToTemplate(row)
      setTemplates((prev) => dedupeTemplates([saved, ...prev.filter((t) => t.id !== saved.id)]))
      // 칩 줄이 없어져 저장 결과가 화면에 안 보이므로 토스트로 알린다
      toast.success(updated ? '즐겨찾기를 업데이트했어요.' : '즐겨찾기에 저장했어요. 제목을 입력하면 불러올 수 있어요.')
    } catch (err) {
      reportSaveError('즐겨찾기에 저장하지 못했어요.', handleSaveTemplate)(err)
    }
  }

  function handleDeleteTemplate(t: PlanTemplate) {
    const index = templates.findIndex((x) => x.id === t.id)
    deleteTemplateWithUndo(t, {
      hide: () => setTemplates((prev) => prev.filter((x) => x.id !== t.id)),
      restore: () => setTemplates((prev) => {
        if (prev.some((x) => x.id === t.id)) return prev
        const next = [...prev]
        next.splice(Math.max(0, index), 0, t)
        return next
      }),
    })
  }

  function applyTemplate(t: PlanTemplate) {
    setTitle(t.title)
    setColor(t.color)
    setIsAllDay(t.isAllDay)
    if (!t.isAllDay) {
      if (t.startTime) setStartTime(t.startTime.slice(0, 5))
      if (t.endTime)   setEndTime(t.endTime.slice(0, 5))
    }
    if (t.linkedMemoIds && t.linkedMemoIds.length > 0) {
      setLinkedMemoIds(t.linkedMemoIds)
      setShowAdvanced(true)
    }
    // 확장 필드 — 있으면 적용 (옵셔널)
    if (t.description) {
      setDescription(t.description)
      setShowAdvanced(true)
    }
    if (t.rruleStr) {
      const baseDate = isRange ? startDate : singleDate
      setRecurrence(parseRRule(t.rruleStr, baseDate))
      setShowAdvanced(true)
    }
    if (typeof t.notifyEnabled === 'boolean') setNotifyEnabled(t.notifyEnabled)
    if (typeof t.notifyLeadMin === 'number') setNotifyLeadMin(t.notifyLeadMin)
    setShowTemplateDropdown(false)
    titleInputRef.current?.blur()

    // 사용 빈도 증가 — fire & forget
    void supabase
      .from('plan_templates')
      .update({
        use_count: (t.useCount ?? 0) + 1,
        last_used_at: new Date().toISOString(),
      })
      .eq('id', t.id)
      .then(() => {
        setTemplates((prev) => prev.map((p) =>
          p.id === t.id
            ? { ...p, useCount: (p.useCount ?? 0) + 1, lastUsedAt: new Date().toISOString() }
            : p,
        ))
      })
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
    if (!isAllDay && !isUndated) {
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
      const rruleStr = isUndated ? null : buildRRule(recurrence, baseDate)
      const data: Partial<Plan> = isUndated ? {
        // 미정(인박스) — 날짜·시간·반복·알림을 모두 비운다 (lib/planner/inbox.ts 정의)
        title: title.trim(),
        description: description.trim(),
        color,
        ...INBOX_RESET_FIELDS,
        ddayTarget,
        linkedMemoIds,
      } : {
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
        notifyEnabled,
        notifyLeadMin,
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
    <Modal
      onClose={onClose}
      ariaLabel={plan ? '플랜 수정' : '새 플랜'}
      sheetOnMobile
      panelClassName="rounded-t-2xl sm:rounded-2xl w-full sm:w-[420px] max-h-[90vh] overflow-y-auto"
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
          {/* 제목 + 즐겨찾기 저장 + 자동완성 드롭다운 */}
          <div className="relative">
            <input
              ref={titleInputRef}
              type="search"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onFocus={() => setShowTemplateDropdown(true)}
              onBlur={() => setTimeout(() => setShowTemplateDropdown(false), 150)}
              placeholder="플랜 제목"
              autoFocus
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-1p-ignore="true"
              data-lpignore="true"
              data-form-type="other"
              name="plan-title"
              className="w-full pl-3.5 pr-10 py-2.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent [&::-webkit-search-cancel-button]:hidden"
            />
            <button
              type="button"
              title="즐겨찾기에 저장"
              onClick={handleSaveTemplate}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-amber-400 transition-colors"
            >
              <Bookmark size={14} />
            </button>

            {/* 즐겨찾기 자동완성 — 제목이 비어 있으면(새 플랜) 자주 쓰는 순, 입력하면 일치 항목.
                2026-11: 상단 칩 줄과 통합. 삭제(되돌리기 가능)도 여기서 */}
            {showTemplateDropdown && matchingTemplates.length > 0 && (title.trim() || !plan) && (
              <div className="absolute left-0 right-0 top-full mt-1 z-20 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg overflow-hidden">
                <p className="px-3 pt-2 pb-1 text-[11px] font-medium text-gray-400">즐겨찾기</p>
                {matchingTemplates.slice(0, 5).map((t) => (
                  <div
                    key={t.id}
                    className="group flex items-center border-t border-gray-100 dark:border-gray-700/60 hover:bg-violet-50 dark:hover:bg-violet-950/20 transition-colors"
                  >
                    <button
                      type="button"
                      onMouseDown={(e) => { e.preventDefault(); applyTemplate(t) }}
                      className="flex-1 min-w-0 flex items-center gap-3 px-3 py-2.5 text-left"
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
                    <button
                      type="button"
                      aria-label={`'${t.title}' 즐겨찾기 삭제`}
                      onMouseDown={(e) => { e.preventDefault(); handleDeleteTemplate(t) }}
                      className="w-9 h-9 mr-1 flex items-center justify-center rounded-md text-gray-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 [@media(hover:hover)]:opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
                    >
                      <X size={13} />
                    </button>
                  </div>
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
                  aria-label={`${COLOR_NAMES[c] ?? c} 색상`}
                  aria-pressed={color === c}
                  className={cn("relative w-6 h-6 rounded-full transition-transform hover:scale-110 before:absolute before:-inset-1 before:content-['']", color === c && 'ring-2 ring-offset-2 ring-gray-400 dark:ring-offset-gray-900')}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          {/* 날짜 유형 + 종일 */}
          <div className="flex items-center gap-4">
            <div role="group" aria-label="날짜 유형" className="flex rounded-lg bg-gray-100 dark:bg-gray-800 p-0.5">
              {([['single', '하루'], ['range', '기간'], ['none', '미정']] as const)
                // 반복 플랜을 '미정'으로 바꾸면 시리즈 전체가 인박스로 가고 완료 기록이 고아가 된다 — 숨김
                .filter(([mode]) => mode !== 'none' || !(plan?.rruleStr || plan?.repeatType || plan?.isRecurringInstance))
                .map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={dateMode === mode}
                  onClick={() => setDateMode(mode)}
                  title={mode === 'none' ? '날짜를 정하지 않고 인박스에 둡니다' : undefined}
                  className={cn(
                    'px-2.5 py-1 text-xs rounded-md transition-colors',
                    dateMode === mode
                      ? 'bg-white dark:bg-gray-700 text-violet-700 dark:text-violet-300 font-semibold shadow-sm'
                      : 'text-gray-500 dark:text-gray-400',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            {!isUndated && <>
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

            {/* 알림 받기 토글 — 시간 지정 플랜에 의미 있음 (종일도 일단 토글 노출, 09:00 기본) */}
            <button
              type="button"
              onClick={() => {
                // 2026-11 옵션 정리: 알림 시점 선택을 없애고 '10분 전' 하나로 (실사용 0건)
                if (!notifyEnabled) setNotifyLeadMin(10)
                setNotifyEnabled((v) => !v)
              }}
              aria-pressed={notifyEnabled}
              title="시작 10분 전에 알려드려요"
              className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400 select-none"
            >
              <span
                className={cn(
                  'relative inline-flex h-4 w-7 items-center rounded-full transition-colors',
                  notifyEnabled ? 'bg-violet-600' : 'bg-gray-300 dark:bg-gray-600',
                )}
              >
                <span
                  className={cn(
                    'absolute h-3 w-3 rounded-full bg-white shadow transition-transform',
                    notifyEnabled ? 'translate-x-3.5' : 'translate-x-0.5',
                  )}
                />
              </span>
              {notifyEnabled ? <Bell size={11} className="text-violet-500" /> : <BellOff size={11} />}
              {notifyEnabled && notifyLeadMin !== 10 ? `알림 ${notifyLeadMin === 0 ? '정시' : `${notifyLeadMin}분 전`}` : '알림 10분 전'}
            </button>
            </>}
          </div>

          {/* 날짜 */}
          {isUndated ? (
            <p className="text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/60 rounded-lg px-3 py-2">
              날짜 없이 인박스에 둬요. 나중에 캘린더로 끌어서 일정을 정할 수 있어요.
            </p>
          ) : isRange ? (
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
          {!isAllDay && !isUndated && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <TimePicker label="시작 시간" value={startTime} onChange={setStartTime} />
                <TimePicker label="종료 시간" value={endTime} onChange={setEndTime} allowMidnight />
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
            {showAdvanced ? '더보기 접기' : '더보기 (메모, 반복, 메모 연결)'}
          </button>

          {showAdvanced && (
            <div className="space-y-4">
              {/* 설명 */}
              <div>
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">메모</p>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="준비물, 링크, 생각해둘 것…"
                  rows={3}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  data-1p-ignore="true"
                  data-lpignore="true"
                  data-form-type="other"
                  name="plan-description"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 outline-none focus:ring-2 focus:ring-violet-500 resize-none"
                />
              </div>

              {/* 반복 — 미정(인박스)에는 의미가 없어 숨김 */}
              {!isUndated && <div>
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">반복</p>
                <div className="flex gap-1.5 flex-wrap">
                  {PRESET_CHIPS.filter((opt) => VISIBLE_PRESETS.includes(opt.value) || opt.value === recurrence.preset).map((opt) => (
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
                        type="search"
                        min={1}
                        max={365}
                        value={intervalStr}
                        autoComplete="off"
                        autoCorrect="off"
                        autoCapitalize="off"
                        spellCheck={false}
                        inputMode="numeric"
                        data-1p-ignore="true"
                        data-lpignore="true"
                        data-form-type="other"
                        name="custom-interval"
                        onChange={(e) => {
                          const raw = e.target.value
                          setIntervalStr(raw)
                          const n = parseInt(raw, 10)
                          if (!isNaN(n) && n >= 1) {
                            setRecurrence((r) => ({ ...r, custom: { ...r.custom, interval: Math.min(365, n) } }))
                          }
                        }}
                        onBlur={() => {
                          const n = parseInt(intervalStr, 10)
                          const valid = isNaN(n) || n < 1 ? 1 : Math.min(365, n)
                          setIntervalStr(String(valid))
                          setRecurrence((r) => ({ ...r, custom: { ...r.custom, interval: valid } }))
                        }}
                        className="w-14 px-2 py-0.5 text-[11px] rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-center [&::-webkit-search-cancel-button]:hidden"
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
                                aria-label={`${wd.label}요일`}
                                aria-pressed={selected}
                                className={cn(
                                  'w-8 h-8 text-xs sm:w-7 sm:h-7 sm:text-[11px] rounded-full transition-colors',
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
                        {(['forever', 'count', 'until'] as EndMode[])
                          // '횟수로 종료'는 기존에 그렇게 저장된 반복만 보여준다 (2026-11 단순화)
                          .filter((m) => m !== 'count' || recurrence.endMode === 'count')
                          .map((m) => (
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
                          type="search"
                          min={1}
                          max={500}
                          value={endCountStr}
                          autoComplete="off"
                          autoCorrect="off"
                          autoCapitalize="off"
                          spellCheck={false}
                          inputMode="numeric"
                          data-1p-ignore="true"
                          data-lpignore="true"
                          data-form-type="other"
                          name="recurrence-count"
                          onChange={(e) => {
                            const raw = e.target.value
                            setEndCountStr(raw)
                            const n = parseInt(raw, 10)
                            if (!isNaN(n) && n >= 1) {
                              setRecurrence((r) => ({ ...r, endCount: Math.min(500, n) }))
                            }
                          }}
                          onBlur={() => {
                            const n = parseInt(endCountStr, 10)
                            const valid = isNaN(n) || n < 1 ? 1 : Math.min(500, n)
                            setEndCountStr(String(valid))
                            setRecurrence((r) => ({ ...r, endCount: valid }))
                          }}
                          className="w-14 px-2 py-0.5 text-[11px] rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-center [&::-webkit-search-cancel-button]:hidden"
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
                          autoComplete="off"
                          data-1p-ignore="true"
                          data-lpignore="true"
                          data-form-type="other"
                          name="recurrence-until"
                          className="px-2 py-0.5 text-[11px] rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800"
                        />
                        <span className="text-[11px] text-gray-500">까지 반복</span>
                      </div>
                    )}
                  </div>
                )}
              </div>}

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
    </Modal>
  )
}
