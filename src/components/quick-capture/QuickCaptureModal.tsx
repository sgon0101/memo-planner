'use client'

/**
 * Quick Capture Modal — 어디서든 빠르게 메모/플랜 작성
 *
 * 단축키: Ctrl/Cmd + Shift + K (KeyboardShortcuts.tsx에서 트리거)
 * FAB: 모바일 우하단 floating button (QuickCaptureFAB.tsx)
 *
 * 메모 탭:
 *  - 제목(optional) + 본문 + 폴더 선택
 *  - 저장 시 Tiptap JSON {paragraph[]}으로 변환해 직접 insert
 *
 * 플랜 탭:
 *  - 제목(required) + 날짜(default 오늘) + 종일/시간 + 색상
 *  - usePlanner.createPlan 호출
 */

import { useEffect, useRef, useState } from 'react'
import { format } from 'date-fns'
import { X, FileText, Calendar, Loader2, CheckCircle } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useQueryClient } from '@tanstack/react-query'
import { useUIStore } from '@/store/uiStore'
import { useFolderStore } from '@/store/folderStore'
import { usePlanner } from '@/hooks/usePlanner'
import { memoKeys, toMemo } from '@/hooks/useMemos'
import { useMemoStore } from '@/store/memoStore'
import { cn } from '@/lib/utils'

const COLORS = ['#7F77DD', '#22C55E', '#F59E0B', '#EF4444', '#06B6D4', '#EC4899'] as const

export default function QuickCaptureModal() {
  const open = useUIStore((s) => s.quickCaptureOpen)
  const mode = useUIStore((s) => s.quickCaptureMode)
  const setMode = useUIStore((s) => s.toggleQuickCaptureMode)
  const close = useUIStore((s) => s.closeQuickCapture)

  if (!open) return null
  return <QuickCaptureInner mode={mode} setMode={setMode} close={close} />
}

function QuickCaptureInner({
  mode,
  setMode,
  close,
}: {
  mode: 'memo' | 'plan'
  setMode: () => void
  close: () => void
}) {
  const supabase = createClient()
  const queryClient = useQueryClient()
  const folders = useFolderStore((s) => s.folders)
  const selectedFolderId = useFolderStore((s) => s.selectedFolderId)
  const addMemoToStore = useMemoStore((s) => s.addMemo)
  const { createPlan } = usePlanner()

  // 공통
  const [title, setTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  // 메모
  const [memoBody, setMemoBody] = useState('')
  const [folderId, setFolderId] = useState<string | null>(
    selectedFolderId && selectedFolderId !== '__trash__' ? selectedFolderId : null,
  )

  // 플랜
  const today = format(new Date(), 'yyyy-MM-dd')
  const [planDate, setPlanDate] = useState(today)
  const [isAllDay, setIsAllDay] = useState(true)
  const [startTime, setStartTime] = useState('09:00')
  const [endTime, setEndTime] = useState('10:00')
  const [color, setColor] = useState<string>(COLORS[0])

  // 진입 시 첫 input focus
  useEffect(() => {
    setTimeout(() => {
      if (mode === 'memo' && bodyRef.current) bodyRef.current.focus()
      else if (titleRef.current) titleRef.current.focus()
    }, 50)
  }, [mode])

  // Esc/Ctrl+Enter — 모달 내부 핸들러
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        save()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, memoBody, planDate, isAllDay, startTime, endTime, folderId, color, mode])

  async function save() {
    if (saving) return
    setError(null)
    if (mode === 'memo') {
      // 메모: 제목 또는 본문 둘 중 하나라도 있어야
      if (!title.trim() && !memoBody.trim()) {
        setError('제목 또는 본문을 입력해주세요')
        return
      }
      setSaving(true)
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) throw new Error('로그인이 필요합니다')

        // 본문을 Tiptap JSON으로 변환 — 빈 줄은 별도 paragraph로 분리
        const paragraphs = memoBody.split('\n').map((line) =>
          line
            ? { type: 'paragraph', content: [{ type: 'text', text: line }] }
            : { type: 'paragraph' }
        )
        const doc = {
          type: 'doc',
          content: paragraphs.length > 0 ? paragraphs : [{ type: 'paragraph' }],
        }

        const { data: row, error } = await supabase
          .from('memos')
          .insert({
            user_id: user.id,
            title: title.trim() || '',
            content: doc,
            content_text: memoBody,
            folder_id: folderId,
          })
          .select()
          .single()
        if (error) throw error

        const memo = toMemo(row)
        addMemoToStore(memo)
        // React Query 캐시 prepend
        queryClient.setQueryData<unknown[]>(memoKeys.all(), (old) => [memo, ...(old ?? [])])
        queryClient.invalidateQueries({ queryKey: ['memo-folder-counts'] })

        flashSuccess()
      } catch (err) {
        setError(err instanceof Error ? err.message : '저장 실패')
        setSaving(false)
      }
    } else {
      // 플랜
      if (!title.trim()) {
        setError('제목을 입력해주세요')
        return
      }
      setSaving(true)
      try {
        await createPlan({
          title: title.trim(),
          color,
          date: planDate,
          isAllDay,
          startTime: isAllDay ? null : startTime,
          endTime: isAllDay ? null : endTime,
          notifyEnabled: false,
          notifyLeadMin: 10,
        })
        flashSuccess()
      } catch (err) {
        setError(err instanceof Error ? err.message : '저장 실패')
        setSaving(false)
      }
    }
  }

  function flashSuccess() {
    setSuccess(true)
    setSaving(false)
    setTimeout(() => {
      setSuccess(false)
      close()
      // 입력 리셋은 모달 unmount로 자동 처리됨 (state 재초기화)
    }, 700)
  }

  function reset() {
    setTitle('')
    setMemoBody('')
    setError(null)
  }

  return (
    <div
      className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4"
      onClick={close}
    >
      <div
        className="w-full sm:max-w-lg bg-white dark:bg-gray-900 rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 — 탭 + 닫기 */}
        <div className="flex items-center justify-between px-3 pt-3 pb-2 border-b border-gray-100 dark:border-gray-800">
          <div className="flex gap-1">
            <TabButton
              active={mode === 'memo'}
              onClick={() => { if (mode !== 'memo') { setMode(); reset() } }}
              icon={<FileText size={13} />}
              label="메모"
            />
            <TabButton
              active={mode === 'plan'}
              onClick={() => { if (mode !== 'plan') { setMode(); reset() } }}
              icon={<Calendar size={13} />}
              label="플랜"
            />
          </div>
          <button
            onClick={close}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
            aria-label="닫기"
          >
            <X size={15} />
          </button>
        </div>

        {/* 본문 */}
        <div className="px-4 py-4 space-y-3">
          {mode === 'memo' ? (
            <>
              <input
                ref={titleRef}
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="제목 (선택)"
                className="w-full px-3 py-2 text-sm font-medium bg-gray-50 dark:bg-gray-800 border-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/30 text-gray-900 dark:text-gray-100 placeholder:text-gray-400"
              />
              <textarea
                ref={bodyRef}
                value={memoBody}
                onChange={(e) => setMemoBody(e.target.value)}
                placeholder="메모 내용을 입력하세요..."
                rows={6}
                className="w-full px-3 py-2 text-sm bg-gray-50 dark:bg-gray-800 border-0 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-violet-500/30 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 leading-relaxed"
              />
              {folders.length > 0 && (
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-500 dark:text-gray-400 shrink-0">폴더</label>
                  <select
                    value={folderId ?? ''}
                    onChange={(e) => setFolderId(e.target.value || null)}
                    className="flex-1 px-2.5 py-1.5 text-xs bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/30 text-gray-700 dark:text-gray-300"
                  >
                    <option value="">미분류</option>
                    {folders.map((f) => (
                      <option key={f.id} value={f.id}>{f.name}</option>
                    ))}
                  </select>
                </div>
              )}
            </>
          ) : (
            <>
              <input
                ref={titleRef}
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="플랜 제목"
                className="w-full px-3 py-2 text-sm font-medium bg-gray-50 dark:bg-gray-800 border-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/30 text-gray-900 dark:text-gray-100 placeholder:text-gray-400"
              />
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-500 dark:text-gray-400 shrink-0">날짜</label>
                <input
                  type="date"
                  value={planDate}
                  onChange={(e) => setPlanDate(e.target.value)}
                  className="flex-1 px-2.5 py-1.5 text-xs bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/30 text-gray-700 dark:text-gray-300"
                />
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isAllDay}
                  onChange={(e) => setIsAllDay(e.target.checked)}
                  className="w-4 h-4 accent-violet-600"
                />
                <span className="text-xs text-gray-700 dark:text-gray-300">종일</span>
              </label>
              {!isAllDay && (
                <div className="flex items-center gap-2">
                  <input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="flex-1 px-2.5 py-1.5 text-xs bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/30 text-gray-700 dark:text-gray-300"
                  />
                  <span className="text-xs text-gray-400">~</span>
                  <input
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="flex-1 px-2.5 py-1.5 text-xs bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500/30 text-gray-700 dark:text-gray-300"
                  />
                </div>
              )}
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-500 dark:text-gray-400 shrink-0">색상</label>
                <div className="flex gap-1.5">
                  {COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setColor(c)}
                      className={cn(
                        'w-6 h-6 rounded-full border-2 transition-all',
                        color === c ? 'border-gray-900 dark:border-white scale-110' : 'border-transparent',
                      )}
                      style={{ backgroundColor: c }}
                      aria-label={c}
                    />
                  ))}
                </div>
              </div>
            </>
          )}

          {error && (
            <div className="text-xs text-red-500 px-1">{error}</div>
          )}
        </div>

        {/* 푸터 — 모바일은 단축키 힌트 숨김 (키보드 없음) */}
        <div className="flex items-center justify-end sm:justify-between px-4 py-3 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-950/30">
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
              success
                ? 'bg-green-600 text-white'
                : 'bg-violet-600 hover:bg-violet-700 text-white',
            )}
          >
            {saving ? <Loader2 size={12} className="animate-spin" />
              : success ? <CheckCircle size={12} />
              : null}
            {success ? '저장됨' : saving ? '저장 중' : '저장'}
          </button>
        </div>
      </div>
    </div>
  )
}

function TabButton({
  active, onClick, icon, label,
}: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors',
        active
          ? 'bg-violet-600 text-white'
          : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800',
      )}
    >
      {icon}
      {label}
    </button>
  )
}
