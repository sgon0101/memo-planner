'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { FileText, CheckSquare, Sparkles, Star, Pin, Plus, ArrowRight } from 'lucide-react'
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

interface HomeClientProps {
  userEmail: string
  totalMemos: number
  completedPlans: number
  recentMemos: RecentMemo[]
  weekPlans: WeekPlan[]
}

function greeting(email: string): string {
  const hour = new Date().getHours()
  const name = email.split('@')[0]
  if (hour < 6)  return `잘 자고 있나요, ${name}님 🌙`
  if (hour < 12) return `좋은 아침이에요, ${name}님 ☀️`
  if (hour < 18) return `즐거운 오후예요, ${name}님 🌤️`
  return `오늘 하루도 수고했어요, ${name}님 🌙`
}

export default function HomeClient({ userEmail, totalMemos, completedPlans, recentMemos, weekPlans }: HomeClientProps) {
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
        linkedPlanIds: [],
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
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
      {/* 인사말 */}
      <div>
        <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">{today}</p>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">
          {greeting(userEmail)}
        </h1>
      </div>

      {/* 통계 카드 */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard
          icon={<FileText size={18} className="text-violet-500" />}
          label="총 메모"
          value={totalMemos}
          bg="bg-violet-50 dark:bg-violet-950/20"
          onClick={() => router.push('/memo')}
        />
        <StatCard
          icon={<CheckSquare size={18} className="text-emerald-500" />}
          label="완료한 플랜"
          value={completedPlans}
          bg="bg-emerald-50 dark:bg-emerald-950/20"
          onClick={() => router.push('/planner')}
        />
        <StatCard
          icon={<Sparkles size={18} className="text-cyan-500" />}
          label="AI 인사이트"
          value="분석하기"
          bg="bg-cyan-50 dark:bg-cyan-950/20"
          onClick={() => router.push('/insights')}
        />
      </div>

      {/* 빠른 메모 입력 */}
      <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-4 shadow-sm">
        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">빠른 메모</p>
        <form onSubmit={handleQuickMemo} className="flex gap-2">
          <input
            type="text"
            value={quickTitle}
            onChange={(e) => setQuickTitle(e.target.value)}
            placeholder="메모 제목을 입력하고 Enter..."
            className="flex-1 px-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-800 dark:text-gray-200 outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
          />
          <button
            type="submit"
            disabled={creating || !quickTitle.trim()}
            className="flex items-center gap-1.5 px-3 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Plus size={14} />
          </button>
        </form>
      </div>

      {/* 최근 메모 */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">최근 메모</h2>
          <button
            onClick={() => router.push('/memo')}
            className="flex items-center gap-1 text-xs text-violet-600 dark:text-violet-400 hover:underline"
          >
            전체 보기 <ArrowRight size={11} />
          </button>
        </div>
        {recentMemos.length === 0 ? (
          <EmptyState
            message="아직 메모가 없어요"
            action="첫 메모 만들기"
            onAction={() => router.push('/memo/new')}
          />
        ) : (
          <div className="space-y-1">
            {recentMemos.map((m) => (
              <button
                key={m.id}
                onClick={() => router.push(`/memo/${m.id}`)}
                className="w-full flex items-start gap-3 px-4 py-3 bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800 hover:border-violet-200 dark:hover:border-violet-800 hover:shadow-sm transition-all text-left"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className={cn(
                      'text-sm font-medium truncate',
                      m.title ? 'text-gray-800 dark:text-gray-200' : 'text-gray-400 italic'
                    )}>
                      {m.title || '제목 없음'}
                    </span>
                    {m.isStarred && <Star size={11} className="text-amber-400 fill-amber-400 flex-shrink-0" />}
                    {m.isPinned && <Pin size={11} className="text-violet-400 flex-shrink-0" />}
                  </div>
                  {m.contentText && (
                    <p className="text-xs text-gray-400 dark:text-gray-500 truncate mt-0.5">{m.contentText}</p>
                  )}
                </div>
                <span className="text-xs text-gray-400 flex-shrink-0 mt-0.5">
                  {formatDistanceToNow(new Date(m.updatedAt), { addSuffix: true, locale: ko })}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* 이번 주 플랜 */}
      <section className="pb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">이번 주 플랜</h2>
          <button
            onClick={() => router.push('/planner')}
            className="flex items-center gap-1 text-xs text-violet-600 dark:text-violet-400 hover:underline"
          >
            플래너 열기 <ArrowRight size={11} />
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
            {weekPlans.map((p) => (
              <div
                key={p.id}
                className={cn(
                  'flex items-center gap-3 px-4 py-3 bg-white dark:bg-gray-900 rounded-xl border border-gray-100 dark:border-gray-800',
                  p.isCompleted && 'opacity-50'
                )}
              >
                <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: p.color }} />
                <div className="flex-1 min-w-0">
                  <span className={cn('text-sm text-gray-800 dark:text-gray-200 truncate block', p.isCompleted && 'line-through')}>{p.title}</span>
                </div>
                {p.date && (
                  <span className="text-xs text-gray-400 flex-shrink-0">
                    {format(new Date(p.date), 'M/d (E)', { locale: ko })}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function StatCard({ icon, label, value, bg, onClick }: {
  icon: React.ReactNode
  label: string
  value: number | string
  bg: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={cn('flex flex-col items-center gap-2 p-4 rounded-2xl border border-gray-100 dark:border-gray-800 hover:shadow-md transition-shadow', bg)}
    >
      {icon}
      <span className="text-xl font-bold text-gray-900 dark:text-white">{value}</span>
      <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
    </button>
  )
}

function EmptyState({ message, action, onAction }: { message: string; action: string; onAction: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 bg-white dark:bg-gray-900 rounded-2xl border border-dashed border-gray-200 dark:border-gray-800 gap-2">
      <p className="text-xs text-gray-400">{message}</p>
      <button onClick={onAction} className="text-xs text-violet-600 dark:text-violet-400 hover:underline">{action}</button>
    </div>
  )
}
