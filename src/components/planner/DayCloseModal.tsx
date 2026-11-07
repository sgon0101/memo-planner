'use client'

/**
 * 하루 마감 — '오늘 엮인 것' + 일지 메모 저장 (2026-11 플래너 개선 — Arch 벤치마크 ④).
 *
 * Arch의 투데이 제로(사진 보상)를 Weave식으로: 그날 완료한 플랜·쓴 메모·위키를 작은 그래프로
 * 보여주고, '일지' 폴더의 하루 1개 메모로 남겨 그래프에 엮는다.
 * 남은 일이 있으면(수동 마감) 그 자리에서 내일로/인박스로 정리할 수 있다.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { addDays, format, parseISO } from 'date-fns'
import { ko } from 'date-fns/locale'
import { X, ArrowRight, Inbox } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { usePlanner, useTodayListQuery } from '@/hooks/usePlanner'
import { memoKeys } from '@/hooks/useMemos'
import { folderKeys } from '@/hooks/useFolders'
import { journalStreak, JOURNAL_FOLDER_NAME } from '@/lib/planner/journal'
import { saveJournal } from '@/lib/planner/journalSave'
import { timeToMinutes } from '@/lib/planner/dragHelpers'
import { reportSaveError } from '@/lib/ui/reportSaveError'
import { toast } from '@/components/ui/Toast'
import { wikiNamesInTitle } from '@/lib/planner/titleTokens'
import PlanTitle from './PlanTitle'
import type { Plan } from '@/types'

interface DayCloseModalProps {
  day: string
  onClose: () => void
}

interface MemoLite { id: string; title: string; wiki_links: string[] | null }

export default function DayCloseModal({ day, onClose }: DayCloseModalProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const { overdue, today } = useTodayListQuery(day)
  const { schedulePlan, sendToInbox } = usePlanner()
  const [reflection, setReflection] = useState('')
  const [saving, setSaving] = useState(false)
  const [moved, setMoved] = useState<{ title: string; to: string }[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  // 같은 틱의 Enter 두 번(한글 IME 확정 Enter 포함)도 한 번만 저장되게 — state는 즉시 안 바뀐다
  const savingRef = useRef(false)

  // 그날 쓴(수정한) 메모 — 일지 자신은 제외
  const { data: memos = [] } = useQuery({
    queryKey: ['day-close', 'memos', day],
    queryFn: async (): Promise<MemoLite[]> => {
      const start = new Date(`${day}T00:00:00`).toISOString()
      const { data, error } = await createClient()
        .from('memos')
        .select('id, title, wiki_links')
        .eq('is_deleted', false)
        .gte('updated_at', start)
        .order('updated_at', { ascending: false })
        .limit(30)
      if (error) throw error
      return ((data ?? []) as MemoLite[]).filter((m) => !/^\d{4}-\d{2}-\d{2} 일지$/.test(m.title ?? ''))
    },
  })
  // 연속 마감 일수 — 'YYYY-MM-DD 일지' 제목으로 계산
  const { data: journalTitles = [] } = useQuery({
    queryKey: ['day-close', 'journals'],
    queryFn: async (): Promise<string[]> => {
      const { data } = await createClient()
        .from('memos').select('title').eq('is_deleted', false).like('title', '____-__-__ 일지').limit(400)
      return (data ?? []).map((r) => r.title as string)
    },
  })

  // 포커스는 처음 열릴 때 한 번만 (onClose가 매 렌더 새 함수라 deps에 두면 포커스가 계속 튄다)
  useEffect(() => { inputRef.current?.focus() }, [])
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !savingRef.current) closeRef.current() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const done = today.filter((p) => p.isCompleted)
  const leftovers = [...overdue, ...today.filter((p) => !p.isCompleted)].filter((p) => !p.isRecurringInstance)
  const plannedMin = done.reduce((sum, p) => (
    !p.isAllDay && p.startTime && p.endTime
      ? sum + Math.max(0, timeToMinutes(p.endTime.slice(0, 5)) - timeToMinutes(p.startTime.slice(0, 5)))
      : sum
  ), 0)

  // 오늘 엮인 위키 — 완료 플랜 제목 + 그날 메모의 위키
  const wikiCounts = useMemo(() => {
    const m = new Map<string, { plans: number; memos: number }>()
    for (const p of done) for (const w of wikiNamesInTitle(p.title)) {
      const c = m.get(w) ?? { plans: 0, memos: 0 }; c.plans++; m.set(w, c)
    }
    for (const memo of memos) for (const w of memo.wiki_links ?? []) {
      const c = m.get(w) ?? { plans: 0, memos: 0 }; c.memos++; m.set(w, c)
    }
    return [...m.entries()].sort((a, b) => (b[1].plans + b[1].memos) - (a[1].plans + a[1].memos)).slice(0, 8)
  }, [done, memos])

  const streakAfter = journalStreak([...journalTitles, `${day} 일지`], day)
  const allDone = leftovers.length === 0 && done.length > 0

  async function moveTomorrow(p: Plan) {
    const tomorrow = format(addDays(parseISO(day), 1), 'yyyy-MM-dd')
    try {
      await schedulePlan(p, { date: tomorrow, startTime: p.startTime, endTime: p.endTime, isAllDay: p.isAllDay }, `'${p.title}'을(를) 내일로 미뤘어요`)
      setMoved((m) => [...m, { title: p.title, to: '내일' }])
    } catch (err) { reportSaveError('내일로 옮기지 못했어요.')(err) }
  }
  async function moveInbox(p: Plan) {
    try {
      await sendToInbox(p)
      setMoved((m) => [...m, { title: p.title, to: '인박스' }])
    } catch (err) { reportSaveError('인박스로 보내지 못했어요.')(err) }
  }

  async function save() {
    if (savingRef.current) return
    savingRef.current = true
    setSaving(true)
    try {
      const result = await saveJournal({
        day,
        dayLabel: format(parseISO(day), 'M월 d일 (eee)', { locale: ko }),
        reflection,
        done: done.map((p) => ({ title: p.title, time: !p.isAllDay && p.startTime ? p.startTime.slice(0, 5) : null })),
        moved,
        memos: memos.slice(0, 10).map((m) => ({ title: m.title })),
        memoWikis: memos.flatMap((m) => m.wiki_links ?? []),
      }, format(new Date(), 'HH:mm'))
      queryClient.invalidateQueries({ queryKey: memoKeys.all() })
      queryClient.invalidateQueries({ queryKey: folderKeys.all() })
      queryClient.invalidateQueries({ queryKey: ['memo-folder-counts'] })
      queryClient.invalidateQueries({ queryKey: ['day-close'] })
      if (result.status === 'locked') {
        toast.warning(`'${day} 일지'가 잠겨 있어 저장하지 않았어요. 잠금을 풀고 다시 마감해주세요.`)
      } else {
        const msg = result.status === 'appended'
          ? '오늘 일지에 이어서 적었어요.'
          : `'${JOURNAL_FOLDER_NAME}' 폴더에 오늘 일지를 남겼어요.`
        toast.success(msg, { action: { label: '열기', onClick: () => router.push(`/memo/${result.memoId}`) } })
      }
      onClose()
    } catch (err) {
      reportSaveError('일지를 저장하지 못했어요.', save)(err)
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  // 작은 그래프 — 가운데 오늘, 둘레에 위키(초록)
  const R = 54, CX = 150, CY = 74
  const nodes = wikiCounts.slice(0, 6).map(([name], i, arr) => {
    const a = (Math.PI * 2 * i) / Math.max(arr.length, 1) - Math.PI / 2
    return { name, x: CX + Math.cos(a) * R * 1.9, y: CY + Math.sin(a) * R }
  })

  return (
    <div className="fixed inset-0 z-[65] flex items-end md:items-center justify-center" role="presentation">
      <div className="absolute inset-0 bg-black/40" onClick={() => !saving && onClose()} aria-hidden="true" />
      <div role="dialog" aria-modal="true" aria-label="하루 마감" className="relative w-full md:w-[420px] max-h-[90vh] overflow-y-auto bg-white dark:bg-gray-900 rounded-t-2xl md:rounded-2xl shadow-2xl">
        <div className="bg-violet-50 dark:bg-violet-950/30 px-5 pt-5 pb-3 relative">
          <button type="button" onClick={onClose} disabled={saving} aria-label="닫기" className="absolute right-2 top-2 w-11 h-11 flex items-center justify-center rounded-lg text-gray-500 hover:bg-white/60 dark:hover:bg-gray-800">
            <X size={18} />
          </button>
          <p className="text-xs font-semibold text-violet-700 dark:text-violet-300">
            {format(parseISO(day), 'M월 d일', { locale: ko })}{streakAfter > 1 ? ` · ${streakAfter}일 연속 마감` : ''}
          </p>
          <h2 className="mt-1 text-2xl font-bold leading-snug text-gray-900 dark:text-white">
            {allDone ? <>오늘 할 일을<br />다 비웠어요</> : <>오늘을<br />마무리할까요?</>}
          </h2>
          {nodes.length > 0 && (
            <svg viewBox="0 0 300 150" className="w-full h-auto mt-1" role="img" aria-label={`오늘 엮인 위키 ${nodes.length}개`}>
              {nodes.map((n) => <line key={`l-${n.name}`} x1={CX} y1={CY} x2={n.x} y2={n.y} stroke="#C4B5FD" strokeWidth="1.5" />)}
              <circle cx={CX} cy={CY} r="15" fill="#7C3AED" />
              <text x={CX} y={CY + 4} textAnchor="middle" fontSize="10" fontWeight="700" fill="#fff">{format(parseISO(day), 'M/d')}</text>
              {nodes.map((n) => (
                <g key={n.name}>
                  <circle cx={n.x} cy={n.y} r="8" fill="#10B981" />
                  <text x={n.x} y={n.y - 12} textAnchor="middle" fontSize="10" className="fill-gray-700 dark:fill-gray-300">{n.name.length > 8 ? `${n.name.slice(0, 8)}…` : n.name}</text>
                </g>
              ))}
            </svg>
          )}
        </div>

        <div className="px-5 pt-4 grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-gray-50 dark:bg-gray-800/60 py-2.5"><div className="text-xl font-bold">{done.length}</div><div className="text-xs text-gray-500">완료</div></div>
          <div className="rounded-xl bg-gray-50 dark:bg-gray-800/60 py-2.5"><div className="text-xl font-bold">{plannedMin ? `${Math.round(plannedMin / 6) / 10}h` : '–'}</div><div className="text-xs text-gray-500">계획한 시간</div></div>
          <div className="rounded-xl bg-gray-50 dark:bg-gray-800/60 py-2.5"><div className="text-xl font-bold">{memos.length}</div><div className="text-xs text-gray-500">쓴 메모</div></div>
        </div>

        {leftovers.length > 0 && (
          <section className="px-5 pt-4" aria-label="남은 일">
            <h3 className="text-sm font-bold text-gray-600 dark:text-gray-300 mb-2">남은 일 {leftovers.length}</h3>
            <ul className="space-y-1.5">
              {leftovers.map((p) => (
                <li key={p.id} className="flex items-center gap-2 rounded-lg bg-amber-50/70 dark:bg-amber-950/20 px-3 min-h-11 text-sm">
                  <PlanTitle title={p.title} className="flex-1 min-w-0 truncate" />
                  <button type="button" onClick={() => moveTomorrow(p)} className="min-h-9 px-2 rounded-md text-xs text-amber-800 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40 inline-flex items-center gap-0.5">내일로 <ArrowRight size={11} aria-hidden="true" /></button>
                  <button type="button" onClick={() => moveInbox(p)} aria-label={`'${p.title}' 인박스로`} className="min-h-9 px-2 rounded-md text-xs text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 inline-flex items-center gap-1"><Inbox size={12} aria-hidden="true" /> 인박스</button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {wikiCounts.length > 0 && (
          <section className="px-5 pt-4" aria-label="오늘 엮인 것">
            <h3 className="text-sm font-bold text-gray-600 dark:text-gray-300 mb-2">오늘 엮인 것</h3>
            <div className="flex flex-wrap gap-1.5">
              {wikiCounts.map(([name, c]) => (
                <span key={name} className="text-xs px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                  [[{name}]] {[c.plans ? `플랜 ${c.plans}` : '', c.memos ? `메모 ${c.memos}` : ''].filter(Boolean).join(' · ')}
                </span>
              ))}
            </div>
          </section>
        )}

        <div className="px-5 pt-4">
          <label htmlFor="day-close-reflection" className="block text-sm font-bold text-gray-600 dark:text-gray-300 mb-2">한 줄 회고</label>
          <input
            ref={inputRef}
            id="day-close-reflection"
            type="search"
            autoComplete="off"
            data-form-type="other"
            data-1p-ignore=""
            value={reflection}
            onChange={(e) => setReflection(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void save() } }}
            placeholder="오늘 하루를 한 줄로"
            className="w-full min-h-12 rounded-xl border-[1.5px] border-violet-200 dark:border-violet-800 bg-white dark:bg-gray-800 px-3.5 text-[15px] outline-none focus:border-violet-500 [&::-webkit-search-cancel-button]:hidden"
          />
        </div>

        <div className="px-5 pt-4 pb-6">
          <button type="button" onClick={() => void save()} disabled={saving} className="w-full min-h-12 rounded-xl bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white font-semibold">
            {saving ? '저장하는 중…' : '일지 메모로 저장하기'}
          </button>
          <p className="mt-2 text-center text-xs text-gray-500">‘{day} 일지’가 ‘{JOURNAL_FOLDER_NAME}’ 폴더에 생기고 위 위키들과 연결돼요</p>
        </div>
      </div>
    </div>
  )
}
