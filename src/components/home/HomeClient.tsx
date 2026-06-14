'use client'

import { useState, useId } from 'react'
import { useRouter } from 'next/navigation'
import { FileText, CheckSquare, Sparkles, Star, Pin, Plus, ArrowRight, Target, Check } from 'lucide-react'
import { formatDistanceToNow, format } from 'date-fns'
import { ko } from 'date-fns/locale'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { useMemoStore } from '@/store/memoStore'

interface RecentMemo {
  id: string
  title: string
  contentText: string
  updatedAt: string
  isStarred: boolean
  isPinned: boolean
}

interface WeekPlan {
  id: string
  title: string
  color: string
  date: string | null
  startDate: string | null
  endDate: string | null
  isCompleted: boolean
  isAllDay: boolean
}

interface DdayPlan {
  id: string
  title: string
  color: string
  ddayTarget: string
}

interface HomeClientProps {
  userName: string
  totalMemos: number | undefined   // undefined = 로딩 중
  completedPlans: number | undefined
  recentMemos: RecentMemo[] | undefined  // undefined = 로딩 중
  weekPlans: WeekPlan[]
  ddayPlans?: DdayPlan[]
}

function greeting(name: string): string {
  const hour = new Date().getHours()
  if (hour < 6)  return `잘 자고 있나요, ${name}님 🌙`
  if (hour < 12) return `좋은 아침이에요, ${name}님 ☀️`
  if (hour < 18) return `즐거운 오후예요, ${name}님 🌤️`
  return `오늘 하루도 수고했어요, ${name}님 🌙`
}

export default function HomeClient({ userName, totalMemos, completedPlans, recentMemos, weekPlans, ddayPlans = [] }: HomeClientProps) {
  // autofill 차단용 비결정 name — useId는 render-safe (Math.random 대체)
  const autofillBlockId = useId()
  // 플랜 완료 토글 — 로컬 즉시 반영 (optimistic) + Supabase 갱신
  const [localPlans, setLocalPlans] = useState(weekPlans)
  // weekPlans prop이 바뀌면 동기화
  if (localPlans !== weekPlans && localPlans.length === 0) setLocalPlans(weekPlans)
  const supabaseClient = createClient()
  async function toggleComplete(id: string, current: boolean) {
    setLocalPlans((prev) => prev.map((p) => p.id === id ? { ...p, isCompleted: !current } : p))
    try {
      await supabaseClient.from('plans').update({ is_completed: !current }).eq('id', id)
    } catch {
      // 실패 시 롤백
      setLocalPlans((prev) => prev.map((p) => p.id === id ? { ...p, isCompleted: current } : p))
    }
  }
  function openPlanInPlanner(plan: { id: string; date: string | null; startDate: string | null }) {
    const d = plan.date ?? plan.startDate
    const qs = new URLSearchParams()
    if (d) qs.set('date', d)
    qs.set('focus', plan.id)
    router.push(`/planner?${qs.toString()}`)
  }

  const router = useRouter()
  const { addMemo } = useMemoStore()
  const [quickTitle, setQuickTitle] = useState('')
  const [creating, setCreating] = useState(false)
  const supabase = createClient()

  async function handleQuickMemo(e: React.FormEvent) {
    e.preventDefault()
    if (!quickTitle.trim()) return
    setCreating(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      const { data, error } = await supabase
        .from('memos')
        .insert({
          user_id: user?.id,
          title: quickTitle.trim(),
          content: { type: 'doc', content: [] },
          content_text: '',
        })
        .select().single()
      if (error) throw error
      addMemo({
        id: data.id,
        userId: data.user_id,
        folderId: null,
        title: data.title,
        content: data.content,
        contentText: data.content_text ?? '',
        isPinned: false,
        isStarred: false,
        isLocked: false,
        lockedContent: null,
        isDeleted: false,
        deletedAt: null,
        tags: [],
        wikiLinks: [],
        linkedPlanIds: [],
        thumbnailUrl: null,
        createdAt: data.created_at,
        updatedAt: data.updated_at,
      })
      router.push(`/memo/${data.id}`)
    } catch {
      // fallback
    } finally {
      setCreating(false)
    }
  }

  const today = format(new Date(), 'yyyy년 M월 d일 EEEE', { locale: ko })

  return (
    <div className="max-w-2xl mx-auto px-4 py-10 space-y-8">
      {/* 인사말 */}
      <div>
        <p suppressHydrationWarning className="text-xs text-gray-400 dark:text-gray-500 mb-1.5 tracking-wide uppercase">{today}</p>
        <h1 suppressHydrationWarning className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight">
          {greeting(userName)}
        </h1>
      </div>

      {/* 통계 카드 */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard
          icon={<FileText size={16} className="text-violet-600" />}
          iconBg="bg-violet-100 dark:bg-violet-950/60"
          label="총 메모"
          value={totalMemos}
          onClick={() => router.push('/memo')}
        />
        <StatCard
          icon={<CheckSquare size={16} className="text-emerald-600" />}
          iconBg="bg-emerald-100 dark:bg-emerald-950/60"
          label="완료한 플랜"
          value={completedPlans}
          onClick={() => router.push('/planner')}
        />
        <StatCard
          icon={<Sparkles size={16} className="text-cyan-600" />}
          iconBg="bg-cyan-100 dark:bg-cyan-950/60"
          label="AI 인사이트"
          value="분석"
          onClick={() => router.push('/insights')}
        />
      </div>

      {/* 다가오는 D-day */}
      {ddayPlans.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <Target size={13} className="text-rose-500" />
            <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">다가오는 D-day</h2>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {ddayPlans.map((p) => {
              const today = new Date(); today.setHours(0, 0, 0, 0)
              const t = new Date(p.ddayTarget); t.setHours(0, 0, 0, 0)
              const diff = Math.round((t.getTime() - today.getTime()) / 86400000)
              const label = diff > 0 ? `D-${diff}` : diff === 0 ? 'D-Day' : `D+${-diff}`
              const tone =
                diff === 0
                  ? 'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30 border-rose-300 dark:border-rose-800'
                  : diff <= 3
                    ? 'text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-900'
                    : diff <= 7
                      ? 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900'
                      : 'text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-800'
              return (
                <button
                  key={p.id}
                  onClick={() => router.push(`/planner?date=${p.ddayTarget}`)}
                  className={cn(
                    'flex flex-col gap-1 px-3 py-2.5 rounded-xl border text-left transition-all hover:shadow-sm cursor-pointer',
                    tone,
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: p.color }} />
                    <span className="text-sm font-bold tabular-nums">{label}</span>
                  </div>
                  <span className="text-xs truncate font-medium opacity-90">{p.title}</span>
                  <span className="text-[10px] opacity-60">{format(new Date(p.ddayTarget), 'M/d (E)', { locale: ko })}</span>
                </button>
              )
            })}
          </div>
        </section>
      )}

      {/* 빠른 메모 입력 */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-4">
        <p className="text-xs font-medium text-gray-400 dark:text-gray-500 mb-3 tracking-wide">빠른 메모</p>
        <form
          onSubmit={handleQuickMemo}
          className="flex gap-2"
          autoComplete="off"
          data-form-type="other"
        >
          <input
            type="search"
            value={quickTitle}
            onChange={(e) => setQuickTitle(e.target.value)}
            placeholder="메모 제목을 입력하고 Enter..."
            autoComplete="new-password"
            autoCorrect="off"
            spellCheck={false}
            data-1p-ignore="true"
            data-lpignore="true"
            data-bitwarden-ignore="true"
            data-form-type="other"
            name={`quick-memo-${autofillBlockId}`}
            className="flex-1 [&::-webkit-search-cancel-button]:hidden px-3 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-200 placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-colors duration-150"
          />
          <button
            type="submit"
            disabled={creating || !quickTitle.trim()}
            className="w-10 h-10 flex items-center justify-center bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white rounded-xl transition-colors duration-150 cursor-pointer flex-shrink-0"
            aria-label="메모 추가"
          >
            <Plus size={15} />
          </button>
        </form>
      </div>

      {/* 최근 메모 */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">최근 메모</h2>
          <button
            onClick={() => router.push('/memo')}
            className="flex items-center gap-1 text-xs text-violet-600 dark:text-violet-400 hover:underline cursor-pointer"
          >
            전체 보기 <ArrowRight size={10} />
          </button>
        </div>
        {recentMemos === undefined ? (
          <div className="space-y-1.5">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-16 bg-gray-100 dark:bg-gray-800 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : recentMemos.length === 0 ? (
          <EmptyState
            message="아직 메모가 없어요"
            action="첫 메모 만들기"
            onAction={() => router.push('/memo/new')}
          />
        ) : (
          <div className="space-y-1.5">
            {recentMemos.map((m) => (
              <button
                key={m.id}
                onClick={() => router.push(`/memo/${m.id}`)}
                className="w-full flex items-start gap-3 px-4 py-3 bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 hover:border-violet-200 dark:hover:border-violet-800 hover:shadow-sm transition-all duration-150 text-left cursor-pointer"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className={cn(
                      'text-sm font-medium truncate',
                      m.title ? 'text-gray-800 dark:text-gray-200' : 'text-gray-400 italic'
                    )}>
                      {m.title || '제목 없음'}
                    </span>
                    {m.isStarred && <Star size={10} className="text-amber-400 fill-amber-400 flex-shrink-0" />}
                    {m.isPinned && <Pin size={10} className="text-violet-400 flex-shrink-0" />}
                  </div>
                  {m.contentText && (
                    <p className="text-xs text-gray-400 dark:text-gray-500 truncate mt-0.5">{m.contentText}</p>
                  )}
                </div>
                <span suppressHydrationWarning className="text-xs text-gray-400 flex-shrink-0 mt-0.5">
                  {formatDistanceToNow(new Date(m.updatedAt), { addSuffix: true, locale: ko })}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* 이번 주 플랜 */}
      <section className="pb-24 md:pb-10">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-300">이번 주 플랜</h2>
          <button
            onClick={() => router.push('/planner')}
            className="flex items-center gap-1 text-xs text-violet-600 dark:text-violet-400 hover:underline cursor-pointer"
          >
            플래너 열기 <ArrowRight size={10} />
          </button>
        </div>
        {weekPlans.length === 0 ? (
          <EmptyState
            message="이번 주 예정된 플랜이 없어요"
            action="플랜 추가하기"
            onAction={() => router.push('/planner')}
          />
        ) : (
          <div className="space-y-1.5">
            {localPlans.map((p) => (
              <div
                key={p.id}
                className={cn(
                  'flex items-center gap-3 px-3 py-3 bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 transition-colors',
                  p.isCompleted && 'opacity-60',
                  'hover:border-violet-200 dark:hover:border-violet-800 active:bg-gray-50 dark:active:bg-gray-800',
                )}
              >
                {/* 완료 체크박스 — 색상 스트립 대신 */}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); toggleComplete(p.id, p.isCompleted) }}
                  aria-label={p.isCompleted ? '완료 해제' : '완료'}
                  className={cn(
                    'flex-shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all',
                    p.isCompleted
                      ? 'border-transparent'
                      : 'border-gray-300 dark:border-gray-600 hover:border-violet-400',
                  )}
                  style={p.isCompleted ? { backgroundColor: p.color } : { borderColor: p.color + '80' }}
                >
                  {p.isCompleted && <Check size={14} className="text-white" />}
                </button>
                {/* 본문 — 탭하면 플래너 상세 */}
                <button
                  type="button"
                  onClick={() => openPlanInPlanner(p)}
                  className="flex-1 min-w-0 text-left flex items-center gap-2 cursor-pointer"
                >
                  <span className={cn('text-sm text-gray-800 dark:text-gray-200 truncate block flex-1', p.isCompleted && 'line-through text-gray-400')}>
                    {p.title}
                  </span>
                  {(p.date || p.startDate) && (
                    <span className="text-xs text-gray-400 flex-shrink-0 bg-gray-50 dark:bg-gray-800 px-2 py-0.5 rounded">
                      {p.date
                        ? format(new Date(p.date), 'M/d (E)', { locale: ko })
                        : `${format(new Date(p.startDate!), 'M/d', { locale: ko })}~${format(new Date(p.endDate!), 'M/d', { locale: ko })}`
                      }
                    </span>
                  )}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function StatCard({ icon, iconBg, label, value, onClick }: {
  icon: React.ReactNode
  iconBg: string
  label: string
  value: number | string | undefined
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col gap-3 p-4 bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 hover:border-violet-200 dark:hover:border-violet-800 hover:shadow-sm transition-all duration-150 cursor-pointer text-left w-full"
    >
      <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0', iconBg)}>
        {icon}
      </div>
      <div>
        {value === undefined
          ? <div className="h-7 w-8 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
          : <p className="text-xl font-bold text-gray-900 dark:text-white leading-none">{value}</p>
        }
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{label}</p>
      </div>
    </button>
  )
}

function EmptyState({ message, action, onAction }: { message: string; action: string; onAction: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 bg-white dark:bg-gray-900 rounded-xl border border-dashed border-gray-200 dark:border-gray-800 gap-2">
      <p className="text-xs text-gray-400">{message}</p>
      <button onClick={onAction} className="text-xs text-violet-600 dark:text-violet-400 hover:underline cursor-pointer">{action}</button>
    </div>
  )
}
