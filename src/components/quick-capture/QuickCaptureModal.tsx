'use client'

import { useEffect, useRef, useState, useMemo } from 'react'
import { format } from 'date-fns'
import {
  X, FileText, Calendar, Loader2, CheckCircle,
  ChevronDown, ChevronUp, Bookmark, BookmarkCheck,
  Link2, Search, Clock, Paperclip, Target, Bell, BellOff,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useUIStore } from '@/store/uiStore'
import Modal from '@/components/ui/Modal'
import { useFolderStore } from '@/store/folderStore'
import { useFolders } from '@/hooks/useFolders'
import { usePlanner } from '@/hooks/usePlanner'
import { memoKeys, toMemo, useMemos } from '@/hooks/useMemos'
import { cn } from '@/lib/utils'
import TimePicker from '@/components/planner/TimePicker'
import {
  type RepeatPreset, type EndMode, type CustomFreq,
  type RecurrenceSettings,
  defaultRecurrence, buildRRule, parseRRule,
} from '@/lib/planner/rrulePresets'
import type { PlanTemplate } from '@/types'

const PRESET_COLORS = ['#7C3AED', '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#EC4899'] as const

const PRESET_CHIPS: { value: RepeatPreset; label: string }[] = [
  { value: 'none',         label: '반복 없음' },
  { value: 'daily',        label: '매일' },
  { value: 'weekdays',     label: '평일만' },
  { value: 'weekly',       label: '매주 같은 요일' },
  { value: 'biweekly',     label: '격주' },
  { value: 'monthly-date', label: '매월 같은 날' },
  { value: 'monthly-day',  label: '매월 같은 요일' },
  { value: 'yearly',       label: '매년' },
  { value: 'custom',       label: '맞춤' },
]

const WEEKDAY_LABELS = [
  { code: 'MO', label: '월' }, { code: 'TU', label: '화' }, { code: 'WE', label: '수' },
  { code: 'TH', label: '목' }, { code: 'FR', label: '금' }, { code: 'SA', label: '토' }, { code: 'SU', label: '일' },
]

export default function QuickCaptureModal() {
  const open = useUIStore((s) => s.quickCaptureOpen)
  const mode = useUIStore((s) => s.quickCaptureMode)
  const setMode = useUIStore((s) => s.toggleQuickCaptureMode)
  const close = useUIStore((s) => s.closeQuickCapture)
  if (!open) return null
  return <QuickCaptureInner mode={mode} setMode={setMode} close={close} />
}

function QuickCaptureInner({
  mode, setMode, close,
}: {
  mode: 'memo' | 'plan'
  setMode: () => void
  close: () => void
}) {
  const supabase = createClient()
  const queryClient = useQueryClient()
  // 모달이 어느 페이지에서 열려도 폴더 목록이 로드되도록 useFolders() 직접 호출
  useFolders()
  const folders = useFolderStore((s) => s.folders)
  const selectedFolderId = useFolderStore((s) => s.selectedFolderId)
  const { memos } = useMemos(undefined) // React Query 단일 출처 (연결 메모 검색용)
  const { createPlan } = usePlanner()

  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ── 메모 탭 ──────────────────────────────────────────────
  const [memoTitle, setMemoTitle] = useState('')
  const [memoBody, setMemoBody] = useState('')
  const [folderId, setFolderId] = useState<string | null>(
    selectedFolderId && selectedFolderId !== '__trash__' ? selectedFolderId : null,
  )
  const [folderOpen, setFolderOpen] = useState(false)
  const folderDropdownRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  // ── 플랜 탭 ──────────────────────────────────────────────
  const today = format(new Date(), 'yyyy-MM-dd')
  const [planTitle, setPlanTitle] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState<string>(PRESET_COLORS[0])
  const [isRange, setIsRange] = useState(false)
  const [singleDate, setSingleDate] = useState(today)
  const [startDate, setStartDate] = useState(today)
  const [endDate, setEndDate] = useState(today)
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('10:00')
  const [isAllDay, setIsAllDay] = useState(true)
  const [recurrence, setRecurrence] = useState<RecurrenceSettings>(() => defaultRecurrence())
  const [intervalStr, setIntervalStr] = useState('1')
  const [endCountStr, setEndCountStr] = useState('1')
  const [notifyEnabled, setNotifyEnabled] = useState(false)
  const [notifyLeadMin, setNotifyLeadMin] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const raw = localStorage.getItem('weave-notif-lead-min')
      const n = raw ? parseInt(raw, 10) : NaN
      if (!isNaN(n) && [0, 5, 10, 30, 60].includes(n)) return n
    }
    return 10
  })
  const [ddayTarget, setDdayTarget] = useState<string | null>(null)
  const [linkedMemoIds, setLinkedMemoIds] = useState<string[]>([])
  const [showMemoPopup, setShowMemoPopup] = useState(false)
  const [memoSearch, setMemoSearch] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showTemplateDropdown, setShowTemplateDropdown] = useState(false)
  const titleInputRef = useRef<HTMLInputElement>(null)

  // 템플릿: React Query 캐시로 모달 재오픈 시 즉시 표시
  const { data: templates = [], refetch: refetchTemplates } = useQuery<PlanTemplate[]>({
    queryKey: ['plan-templates'],
    queryFn: async () => {
      const { data } = await supabase
        .from('plan_templates')
        .select('*')
        .order('use_count', { ascending: false })
        .order('last_used_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
      return (data ?? []).map((r) => ({
        id: r.id, userId: r.user_id, title: r.title, color: r.color,
        startTime: r.start_time ?? null, endTime: r.end_time ?? null,
        isAllDay: r.is_all_day ?? true, linkedMemoIds: r.linked_memo_ids ?? [],
        description: r.description ?? null,
        rruleStr: r.rrule_str ?? null,
        notifyEnabled: r.notify_enabled ?? false,
        notifyLeadMin: r.notify_lead_min ?? 10,
        useCount: r.use_count ?? 0,
        lastUsedAt: r.last_used_at ?? null,
        createdAt: r.created_at,
      }))
    },
    staleTime: 30_000,
  })

  const activeMemos = memos.filter((m) => !m.isDeleted && !m.isLocked)

  const matchingTemplates = useMemo(() => {
    const q = planTitle.trim().toLowerCase()
    if (!q) return []
    return templates.filter((t) => t.title.toLowerCase().includes(q))
  }, [templates, planTitle])

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

  // 탭 전환 시 첫 input 포커스
  useEffect(() => {
    setTimeout(() => {
      if (mode === 'memo' && bodyRef.current) bodyRef.current.focus()
      else if (titleInputRef.current) titleInputRef.current.focus()
    }, 50)
  }, [mode])

  // 폴더 드롭다운 외부 클릭 닫기
  useEffect(() => {
    if (!folderOpen) return
    function handleClick(e: MouseEvent) {
      if (folderDropdownRef.current && !folderDropdownRef.current.contains(e.target as Node)) {
        setFolderOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [folderOpen])

  // Esc / Ctrl+Enter
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); close(); return }
      // eslint-disable-next-line react-hooks/immutability -- save는 함수 선언(호이스팅)이라 안전
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); save() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, memoTitle, memoBody, folderId, planTitle, description, color, isRange,
      singleDate, startDate, endDate, startTime, endTime, isAllDay,
      recurrence, notifyEnabled, notifyLeadMin, ddayTarget, linkedMemoIds])

  function calcDuration(s: string, e: string) {
    const [sh, sm] = s.split(':').map(Number)
    const [eh, em] = e.split(':').map(Number)
    const diff = (eh * 60 + em) - (sh * 60 + sm)
    if (diff <= 0) return ''
    const h = Math.floor(diff / 60), m = diff % 60
    if (m === 0) return `${h}시간`
    if (h === 0) return `${m}분`
    return `${h}시간 ${m}분`
  }

  function toggleMemo(id: string) {
    setLinkedMemoIds((prev) => prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id])
  }

  async function handleSaveTemplate() {
    if (!planTitle.trim()) return
    const { data: { session } } = await supabase.auth.getSession(); const user = session?.user ?? null
    const baseDate = isRange ? startDate : singleDate
    await supabase.from('plan_templates').insert({
      user_id: user?.id, title: planTitle.trim(), color,
      start_time: isAllDay ? null : (startTime || null),
      end_time: isAllDay ? null : (endTime || null),
      is_all_day: isAllDay, linked_memo_ids: linkedMemoIds,
      description: description.trim() || null,
      rrule_str: buildRRule(recurrence, baseDate),
      notify_enabled: notifyEnabled,
      notify_lead_min: notifyLeadMin,
    })
    refetchTemplates()
  }

  async function handleDeleteTemplate(id: string) {
    await supabase.from('plan_templates').delete().eq('id', id)
    refetchTemplates()
  }

  function applyTemplate(t: PlanTemplate) {
    setPlanTitle(t.title); setColor(t.color); setIsAllDay(t.isAllDay)
    if (!t.isAllDay) {
      if (t.startTime) setStartTime(t.startTime.slice(0, 5))
      if (t.endTime) setEndTime(t.endTime.slice(0, 5))
    }
    if (t.linkedMemoIds && t.linkedMemoIds.length > 0) { setLinkedMemoIds(t.linkedMemoIds); setShowAdvanced(true) }
    if (t.description) { setDescription(t.description); setShowAdvanced(true) }
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
    void supabase.from('plan_templates')
      .update({ use_count: (t.useCount ?? 0) + 1, last_used_at: new Date().toISOString() })
      .eq('id', t.id)
  }

  async function save() {
    if (saving) return
    setError(null)
    if (mode === 'memo') {
      if (!memoTitle.trim() && !memoBody.trim()) { setError('제목 또는 본문을 입력해주세요'); return }
      setSaving(true)
      try {
        const { data: { session } } = await supabase.auth.getSession(); const user = session?.user ?? null
        if (!user) throw new Error('로그인이 필요합니다')
        const paragraphs = memoBody.split('\n').map((line) =>
          line ? { type: 'paragraph', content: [{ type: 'text', text: line }] } : { type: 'paragraph' }
        )
        const doc = { type: 'doc', content: paragraphs.length > 0 ? paragraphs : [{ type: 'paragraph' }] }
        const { data: row, error: insertErr } = await supabase.from('memos').insert({
          user_id: user.id, title: memoTitle.trim() || '',
          content: doc, content_text: memoBody, folder_id: folderId,
        }).select().single()
        if (insertErr) throw insertErr
        const memo = toMemo(row)
        queryClient.setQueryData<unknown[]>(memoKeys.all(), (old) => [memo, ...(old ?? [])])
        queryClient.invalidateQueries({ queryKey: ['memo-folder-counts'] })
        flashSuccess()
      } catch (err) {
        setError(err instanceof Error ? err.message : '저장 실패')
        setSaving(false)
      }
    } else {
      if (!planTitle.trim()) { setError('제목을 입력해주세요'); return }
      if (!isAllDay) {
        const [sh, sm] = startTime.split(':').map(Number)
        const [eh, em] = endTime.split(':').map(Number)
        if (eh * 60 + em <= sh * 60 + sm) { setError('종료 시간은 시작 시간보다 늦어야 해요.'); return }
      }
      setSaving(true)
      try {
        const baseDate = isRange ? startDate : singleDate
        const rruleStr = buildRRule(recurrence, baseDate)
        await createPlan({
          title: planTitle.trim(), description: description.trim(), color, isAllDay,
          date: isRange ? null : singleDate,
          startDate: isRange ? startDate : null,
          endDate: isRange ? endDate : null,
          startTime: isAllDay ? null : (startTime || null),
          endTime: isAllDay ? null : (endTime || null),
          rruleStr, repeatType: null,
          repeatEndDate: recurrence.endMode === 'until' ? recurrence.endUntil : null,
          notifyEnabled, notifyLeadMin, ddayTarget, linkedMemoIds,
        })
        flashSuccess()
      } catch (err) {
        setError(err instanceof Error ? err.message : '저장 실패')
        setSaving(false)
      }
    }
  }

  function flashSuccess() {
    setSuccess(true); setSaving(false)
    setTimeout(() => { setSuccess(false); close() }, 700)
  }

  function reset() {
    setMemoTitle(''); setMemoBody(''); setPlanTitle(''); setError(null)
  }

  const selectedFolder = folders.find((f) => f.id === folderId)

  // FolderPanel과 동일한 depth-first 순서로 폴더 목록 평탄화
  const folderTree = useMemo(() => {
    const result: { folder: typeof folders[number]; depth: number }[] = []
    function traverse(parentId: string | null, depth: number) {
      folders
        .filter((f) => f.parentId === parentId)
        .sort((a, b) => a.orderIndex - b.orderIndex)
        .forEach((f) => {
          result.push({ folder: f, depth })
          traverse(f.id, depth + 1)
        })
    }
    traverse(null, 0)
    return result
  }, [folders])

  return (
    <Modal
      onClose={close}
      ariaLabel="빠른 작성"
      sheetOnMobile
      overlayClassName="p-0 sm:p-4"
      panelClassName="w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[92vh]"
    >
        {/* 헤더 */}
        <div className="flex items-center justify-between px-3 pt-3 pb-2 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
          <div className="flex gap-1">
            <TabButton active={mode === 'memo'} onClick={() => { if (mode !== 'memo') { setMode(); reset() } }} icon={<FileText size={13} />} label="메모" />
            <TabButton active={mode === 'plan'} onClick={() => { if (mode !== 'plan') { setMode(); reset() } }} icon={<Calendar size={13} />} label="플랜" />
          </div>
          <button onClick={close} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800">
            <X size={15} />
          </button>
        </div>

        {/* 스크롤 본문 */}
        <div className="overflow-y-auto flex-1 px-4 py-4 space-y-3">

          {/* ───────────── 메모 탭 ───────────── */}
          {mode === 'memo' && (
            <>
              <input
                type="search"
                value={memoTitle}
                onChange={(e) => setMemoTitle(e.target.value)}
                placeholder="제목 (선택)"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                data-1p-ignore="true"
                data-lpignore="true"
                data-form-type="other"
                name="memo-title-qc"
                className="w-full px-3 py-2 text-sm font-medium bg-gray-50 dark:bg-gray-800 border-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/30 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 [&::-webkit-search-cancel-button]:hidden"
              />
              <textarea
                ref={bodyRef}
                value={memoBody}
                onChange={(e) => setMemoBody(e.target.value)}
                placeholder="메모 내용을 입력하세요..."
                rows={6}
                className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-800 border-0 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-violet-500/30 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 leading-relaxed"
              />

              {/* 폴더 — 커스텀 드롭다운 (FolderPanel과 동일한 계층 순서) */}
              {folderTree.length > 0 && (
                <div ref={folderDropdownRef} className="relative">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">폴더</span>
                    <button
                      type="button"
                      onClick={() => setFolderOpen((v) => !v)}
                      className="flex-1 flex items-center gap-2 px-2.5 py-1.5 text-xs bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:border-violet-400 transition-colors text-left"
                    >
                      {selectedFolder ? (
                        <>
                          <span
                            className="w-3 h-3 rounded-full flex-shrink-0"
                            style={{ backgroundColor: `hsl(${selectedFolder.colorH},${selectedFolder.colorS}%,${selectedFolder.colorL}%)` }}
                          />
                          <span className="flex-1 truncate text-gray-700 dark:text-gray-300">{selectedFolder.name}</span>
                        </>
                      ) : (
                        <span className="flex-1 text-gray-400">미분류</span>
                      )}
                      <ChevronDown size={12} className={cn('text-gray-400 flex-shrink-0 transition-transform', folderOpen && 'rotate-180')} />
                    </button>
                  </div>

                  {folderOpen && (
                    <div className="absolute left-12 right-0 top-full mt-1 z-20 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg overflow-hidden max-h-48 overflow-y-auto">
                      {/* 미분류 */}
                      <button
                        type="button"
                        onClick={() => { setFolderId(null); setFolderOpen(false) }}
                        className={cn(
                          'w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors',
                          !folderId
                            ? 'bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-300'
                            : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700',
                        )}
                      >
                        <span className="w-3 h-3 rounded-full bg-gray-300 dark:bg-gray-600 flex-shrink-0" />
                        미분류
                      </button>
                      {/* 트리 순서 폴더 목록 */}
                      {folderTree.map(({ folder: f, depth }) => (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() => { setFolderId(f.id); setFolderOpen(false) }}
                          className={cn(
                            'w-full flex items-center gap-1.5 py-2 pr-3 text-xs border-t border-gray-100 dark:border-gray-700/50 transition-colors',
                            folderId === f.id
                              ? 'bg-violet-50 dark:bg-violet-950/30 text-violet-700 dark:text-violet-300'
                              : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700',
                          )}
                          style={{ paddingLeft: `${12 + depth * 14}px` }}
                        >
                          {depth > 0 && (
                            <span className="text-gray-300 dark:text-gray-600 flex-shrink-0 text-[10px] leading-none">└</span>
                          )}
                          <span
                            className="w-3 h-3 rounded-full flex-shrink-0"
                            style={{ backgroundColor: `hsl(${f.colorH},${f.colorS}%,${f.colorL}%)` }}
                          />
                          <span className="truncate">{f.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* ───────────── 플랜 탭 ───────────── */}
          {mode === 'plan' && (
            <div className="space-y-3">
              {/* 즐겨찾기 템플릿 */}
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
                            <span className="text-gray-400 ml-0.5">{t.startTime.slice(0, 5)}</span>
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

              {/* 제목 + 즐겨찾기 저장 버튼 + 자동완성 */}
              <div className="relative">
                <input
                  ref={titleInputRef}
                  type="search"
                  value={planTitle}
                  onChange={(e) => setPlanTitle(e.target.value)}
                  onFocus={() => setShowTemplateDropdown(true)}
                  onBlur={() => setTimeout(() => setShowTemplateDropdown(false), 150)}
                  placeholder="플랜 제목"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  data-1p-ignore="true"
                  data-lpignore="true"
                  data-form-type="other"
                  name="plan-title-qc"
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
                                {t.startTime.slice(0, 5)}{t.endTime ? `~${t.endTime.slice(0, 5)}` : ''}
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
                <p className="text-xs text-gray-500 dark:text-gray-400 w-10 flex-shrink-0">색상</p>
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

              {/* 날짜 유형 + 종일 + 알림 */}
              <div className="flex items-center gap-3 flex-wrap">
                <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400 cursor-pointer select-none">
                  <input type="checkbox" checked={isRange} onChange={(e) => setIsRange(e.target.checked)} className="accent-violet-600" />
                  범위 플랜
                </label>
                <button
                  type="button"
                  onClick={() => setIsAllDay((v) => !v)}
                  className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400 select-none"
                >
                  <span className={cn('relative inline-flex h-4 w-7 items-center rounded-full transition-colors', isAllDay ? 'bg-violet-600' : 'bg-gray-300 dark:bg-gray-600')}>
                    <span className={cn('absolute h-3 w-3 rounded-full bg-white shadow transition-transform', isAllDay ? 'translate-x-3.5' : 'translate-x-0.5')} />
                  </span>
                  종일
                </button>
                <button
                  type="button"
                  onClick={() => setNotifyEnabled((v) => !v)}
                  className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400 select-none"
                >
                  <span className={cn('relative inline-flex h-4 w-7 items-center rounded-full transition-colors', notifyEnabled ? 'bg-violet-600' : 'bg-gray-300 dark:bg-gray-600')}>
                    <span className={cn('absolute h-3 w-3 rounded-full bg-white shadow transition-transform', notifyEnabled ? 'translate-x-3.5' : 'translate-x-0.5')} />
                  </span>
                  {notifyEnabled ? <Bell size={11} className="text-violet-500" /> : <BellOff size={11} />}
                  알림
                </button>
              </div>

              {/* 알림 시점 */}
              {notifyEnabled && (
                <div className="flex items-center gap-1.5 flex-wrap pl-2">
                  <span className="text-[11px] text-gray-500 dark:text-gray-400 flex items-center gap-1 mr-1">
                    <Bell size={10} className="text-violet-500" /> 시점
                  </span>
                  {[0, 5, 10, 30, 60].map((min) => (
                    <button
                      key={min}
                      type="button"
                      onClick={() => setNotifyLeadMin(min)}
                      className={cn(
                        'text-[11px] px-2 py-0.5 rounded-full border transition-colors',
                        notifyLeadMin === min
                          ? 'border-violet-500 bg-violet-50 dark:bg-violet-950/30 text-violet-600 dark:text-violet-400'
                          : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400',
                      )}
                    >
                      {min === 0 ? '정시' : `${min}분 전`}
                    </button>
                  ))}
                </div>
              )}

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
                    <input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)}
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
                      autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
                      data-1p-ignore="true" data-lpignore="true" data-form-type="other" name="plan-desc-qc"
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
                              : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300',
                          )}
                        >{opt.label}</button>
                      ))}
                    </div>

                    {recurrence.preset === 'custom' && (
                      <div className="mt-3 p-3 rounded-lg border border-violet-200 dark:border-violet-900/50 bg-violet-50/30 dark:bg-violet-950/10 space-y-2.5">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-medium text-gray-500 w-10 flex-shrink-0">단위</span>
                          <div className="flex gap-1">
                            {(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'] as CustomFreq[]).map((f) => (
                              <button key={f} type="button"
                                onClick={() => setRecurrence((r) => ({ ...r, custom: { ...r.custom, freq: f } }))}
                                className={cn('px-2 py-0.5 text-[11px] rounded border transition-colors',
                                  recurrence.custom.freq === f
                                    ? 'border-violet-500 bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-400'
                                    : 'border-gray-200 dark:border-gray-700 text-gray-500',
                                )}
                              >{({ DAILY: '일', WEEKLY: '주', MONTHLY: '월', YEARLY: '년' } as const)[f]}</button>
                            ))}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-medium text-gray-500 w-10 flex-shrink-0">간격</span>
                          <input
                            type="search" value={intervalStr} inputMode="numeric"
                            autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
                            data-1p-ignore="true" data-lpignore="true" data-form-type="other" name="interval-qc"
                            onChange={(e) => {
                              const raw = e.target.value; setIntervalStr(raw)
                              const n = parseInt(raw, 10)
                              if (!isNaN(n) && n >= 1) setRecurrence((r) => ({ ...r, custom: { ...r.custom, interval: Math.min(365, n) } }))
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
                        {recurrence.custom.freq === 'WEEKLY' && (
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-medium text-gray-500 w-10 flex-shrink-0">요일</span>
                            <div className="flex gap-1 flex-wrap">
                              {WEEKDAY_LABELS.map((wd) => {
                                const selected = recurrence.custom.byday.includes(wd.code)
                                return (
                                  <button key={wd.code} type="button"
                                    onClick={() => setRecurrence((r) => ({ ...r, custom: { ...r.custom, byday: selected ? r.custom.byday.filter((b) => b !== wd.code) : [...r.custom.byday, wd.code] } }))}
                                    className={cn('w-6 h-6 text-[10px] rounded-full transition-colors',
                                      selected ? 'bg-violet-600 text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700',
                                    )}
                                  >{wd.label}</button>
                                )
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {recurrence.preset !== 'none' && (
                      <div className="mt-3 p-3 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/30 space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-medium text-gray-500 w-10 flex-shrink-0">종료</span>
                          <div className="flex gap-1">
                            {(['forever', 'count', 'until'] as EndMode[]).map((m) => (
                              <button key={m} type="button"
                                onClick={() => setRecurrence((r) => ({ ...r, endMode: m }))}
                                className={cn('px-2 py-0.5 text-[11px] rounded border transition-colors',
                                  recurrence.endMode === m
                                    ? 'border-violet-500 bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-400'
                                    : 'border-gray-200 dark:border-gray-700 text-gray-500',
                                )}
                              >{({ forever: '끝없음', count: '횟수', until: '날짜' } as const)[m]}</button>
                            ))}
                          </div>
                        </div>
                        {recurrence.endMode === 'count' && (
                          <div className="flex items-center gap-2 pl-12">
                            <input
                              type="search" value={endCountStr} inputMode="numeric"
                              autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
                              data-1p-ignore="true" data-lpignore="true" data-form-type="other" name="endcount-qc"
                              onChange={(e) => {
                                const raw = e.target.value; setEndCountStr(raw)
                                const n = parseInt(raw, 10)
                                if (!isNaN(n) && n >= 1) setRecurrence((r) => ({ ...r, endCount: Math.min(500, n) }))
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
                            <input type="date" value={recurrence.endUntil ?? ''} min={isRange ? startDate : singleDate}
                              onChange={(e) => setRecurrence((r) => ({ ...r, endUntil: e.target.value || null }))}
                              className="px-2 py-0.5 text-[11px] rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800" />
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
                        <button type="button" onClick={() => setDdayTarget(null)} className="text-[11px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">해제</button>
                      )}
                    </div>
                    {ddayTarget ? (
                      <div className="flex items-center gap-2">
                        <input type="date" value={ddayTarget} onChange={(e) => setDdayTarget(e.target.value || null)}
                          className="flex-1 px-2.5 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white outline-none focus:ring-1 focus:ring-rose-500" />
                        <span className="text-xs font-medium text-rose-500 whitespace-nowrap">
                          {(() => {
                            const t2 = new Date(); t2.setHours(0, 0, 0, 0)
                            const t = new Date(ddayTarget); t.setHours(0, 0, 0, 0)
                            const diff = Math.round((t.getTime() - t2.getTime()) / 86400000)
                            if (diff > 0) return `D-${diff}`
                            if (diff === 0) return 'D-Day'
                            return `D+${-diff}`
                          })()}
                        </span>
                      </div>
                    ) : (
                      <button type="button" onClick={() => setDdayTarget(singleDate)}
                        className="w-full px-3 py-2 text-xs text-rose-500 border border-dashed border-rose-200 dark:border-rose-900/50 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/20 transition-colors">
                        + 목표일 지정 (홈 화면에 카운트다운 표시)
                      </button>
                    )}
                  </div>

                  {/* 메모 연결 */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-xs font-medium text-gray-500 dark:text-gray-400">메모 연결</p>
                      <button type="button"
                        onClick={() => { const next = !showMemoPopup; setShowMemoPopup(next); if (!next) setMemoSearch('') }}
                        className="flex items-center gap-1 text-xs text-violet-600 dark:text-violet-400 hover:underline"
                      >
                        <Link2 size={11} />
                        {linkedMemoIds.length > 0 ? `${linkedMemoIds.length}개 연결됨` : '메모 선택'}
                      </button>
                    </div>
                    {showMemoPopup && (
                      <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
                        <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                          <Search size={12} className="text-gray-400 flex-shrink-0" />
                          <input type="text" value={memoSearch} onChange={(e) => setMemoSearch(e.target.value)}
                            placeholder="제목 · 내용 · #태그 · [[위키"
                            className="flex-1 text-xs bg-transparent outline-none text-gray-700 dark:text-gray-300 placeholder-gray-400 dark:placeholder-gray-500" autoComplete="off" />
                          {memoSearch && (
                            <button type="button" onClick={() => setMemoSearch('')} className="text-gray-400 hover:text-gray-600 flex-shrink-0"><X size={11} /></button>
                          )}
                        </div>
                        <div className="max-h-40 overflow-y-auto">
                          {filteredMemos.length === 0 ? (
                            <p className="text-xs text-gray-400 text-center py-4">{memoSearch ? '검색 결과가 없습니다' : '연결할 메모가 없습니다'}</p>
                          ) : (
                            filteredMemos.map((m) => {
                              const linked = linkedMemoIds.includes(m.id)
                              return (
                                <button key={m.id} type="button" onClick={() => toggleMemo(m.id)}
                                  className={cn('w-full flex items-center gap-2 px-3 py-2 text-xs text-left border-b border-gray-100 dark:border-gray-800 last:border-0 transition-colors',
                                    linked ? 'bg-violet-50 dark:bg-violet-950/20 text-violet-700 dark:text-violet-300' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                                  )}>
                                  {linked ? <BookmarkCheck size={11} className="text-violet-500 flex-shrink-0" /> : <Bookmark size={11} className="text-gray-400 flex-shrink-0" />}
                                  <span className="truncate flex-1">{m.title || '제목 없음'}</span>
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
            </div>
          )}

          {error && <div className="text-xs text-red-500 px-1">{error}</div>}
        </div>

        {/* 푸터 */}
        <div className="flex items-center justify-end sm:justify-between px-4 py-3 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-950/30 flex-shrink-0">
          <span className="hidden sm:inline text-[11px] text-gray-400 dark:text-gray-500">
            <kbd className="px-1 py-0.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded font-mono text-[10px]">Ctrl+Enter</kbd>
            {' '}저장 ·{' '}
            <kbd className="px-1 py-0.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded font-mono text-[10px]">Esc</kbd>
            {' '}닫기
          </span>
          <button
            onClick={save}
            disabled={saving || success}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg transition-colors disabled:opacity-60',
              success ? 'bg-green-600 text-white' : 'bg-violet-600 hover:bg-violet-700 text-white',
            )}
          >
            {saving ? <Loader2 size={12} className="animate-spin" />
              : success ? <CheckCircle size={12} />
              : null}
            {success ? '저장됨' : saving ? '저장 중' : '저장'}
          </button>
        </div>
    </Modal>
  )
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors',
        active ? 'bg-violet-600 text-white' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800',
      )}
    >
      {icon}
      {label}
    </button>
  )
}
