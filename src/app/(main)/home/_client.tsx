'use client'

import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { startOfWeek, endOfWeek, format as fmtDate } from 'date-fns'
import { createClient } from '@/lib/supabase/client'
import { memoKeys, LIST_COLS, toMemo } from '@/hooks/useMemos'
import HomeClient from '@/components/home/HomeClient'

const HOME_STALE = 5 * 60 * 1000

// 홈 전용 메모 캐시 (count + 최근 5개) — 전체 memo fetch 없이 경량 쿼리
const LS_HOME_MEMOS_KEY = 'home-memos-cache'
const LS_HOME_MEMOS_TS_KEY = 'home-memos-cache-ts'
const LS_STATS_KEY = 'home-stats-cache'
const LS_STATS_TS_KEY = 'home-stats-cache-ts'

interface HomeMemos {
  totalMemos: number
  recentMemos: Array<{
    id: string
    title: string
    contentText: string
    updatedAt: string
    isStarred: boolean
    isPinned: boolean
  }>
}

function readHomeMemoCache(): HomeMemos | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    const v = localStorage.getItem(LS_HOME_MEMOS_KEY)
    return v ? (JSON.parse(v) as HomeMemos) : undefined
  } catch { return undefined }
}

function readHomeMemoTs(): number {
  if (typeof window === 'undefined') return 0
  try {
    const v = localStorage.getItem(LS_HOME_MEMOS_TS_KEY)
    return v ? parseInt(v, 10) : 0
  } catch { return 0 }
}

function readStatsCache() {
  if (typeof window === 'undefined') return undefined
  try {
    const v = localStorage.getItem(LS_STATS_KEY)
    return v ? JSON.parse(v) : undefined
  } catch { return undefined }
}

function readStatsCacheTs(): number {
  if (typeof window === 'undefined') return 0
  try {
    const v = localStorage.getItem(LS_STATS_TS_KEY)
    return v ? parseInt(v, 10) : 0
  } catch { return 0 }
}

export default function HomePageClient() {
  const queryClient = useQueryClient()

  // 메모 탭 캐시 백그라운드 사전 로딩 — 홈 렌더 후 실행되므로 display 차단 없음
  // staleTime 이내 데이터가 있으면 자동으로 건너뜀
  useEffect(() => {
    queryClient.prefetchQuery({
      queryKey: memoKeys.all(),
      queryFn: async () => {
        const supabase = createClient()
        const { data } = await supabase
          .from('memos')
          .select(LIST_COLS)
          .eq('is_deleted', false)
          .order('is_pinned', { ascending: false })
          .order('updated_at', { ascending: false })
        return (data ?? []).map(toMemo)
      },
      staleTime: 5 * 60 * 1000,
    })
  }, [queryClient])

  // 홈 전용 경량 쿼리 — 전체 메모 fetch 없이 count + 최근 5개만 병렬 요청
  const { data: homeMemos } = useQuery<HomeMemos>({
    queryKey: ['home-memos'],
    queryFn: async (): Promise<HomeMemos> => {
      const supabase = createClient()
      const [{ count }, { data: recent }] = await Promise.all([
        supabase
          .from('memos')
          .select('*', { count: 'exact', head: true })
          .eq('is_deleted', false),
        supabase
          .from('memos')
          .select('id, title, content_text, updated_at, is_starred, is_pinned')
          .eq('is_deleted', false)
          .order('updated_at', { ascending: false })
          .limit(5),
      ])
      return {
        totalMemos: count ?? 0,
        recentMemos: (recent ?? []).map((m) => ({
          id: m.id as string,
          title: (m.title as string | null) ?? '',
          contentText: (m.content_text as string | null) ?? '',
          updatedAt: m.updated_at as string,
          isStarred: (m.is_starred as boolean | null) ?? false,
          isPinned: (m.is_pinned as boolean | null) ?? false,
        })),
      }
    },
    staleTime: 2 * 60 * 1000,
    initialData: readHomeMemoCache,
    initialDataUpdatedAt: readHomeMemoTs,
  })

  useEffect(() => {
    if (homeMemos) {
      localStorage.setItem(LS_HOME_MEMOS_KEY, JSON.stringify(homeMemos))
      localStorage.setItem(LS_HOME_MEMOS_TS_KEY, String(Date.now()))
    }
  }, [homeMemos])

  // 사용자 이메일 — Supabase 클라이언트 세션에서 즉각 (로컬 토큰)
  const { data: userEmail = '' } = useQuery({
    queryKey: ['user-email'],
    queryFn: async () => {
      const { data: { user } } = await createClient().auth.getUser()
      return user?.email ?? ''
    },
    staleTime: Infinity,
  })

  // 플랜 통계 — localStorage 즉시 표시 + 백그라운드 갱신
  const { data: stats } = useQuery({
    queryKey: ['home-stats'],
    queryFn: async () => {
      const supabase = createClient()
      const now = new Date()
      const weekStart = fmtDate(startOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd')
      const weekEnd   = fmtDate(endOfWeek(now,   { weekStartsOn: 1 }), 'yyyy-MM-dd')

      const [
        { count: completedPlans },
        { data: singleDayPlans },
        { data: rangePlans },
      ] = await Promise.all([
        supabase.from('plans')
          .select('*', { count: 'exact', head: true })
          .eq('is_completed', true),
        supabase.from('plans')
          .select('id, title, color, date, start_date, end_date, is_completed, is_all_day')
          .gte('date', weekStart).lte('date', weekEnd)
          .order('date', { ascending: true }).limit(20),
        supabase.from('plans')
          .select('id, title, color, date, start_date, end_date, is_completed, is_all_day')
          .is('date', null)
          .lte('start_date', weekEnd).gte('end_date', weekStart)
          .order('start_date', { ascending: true }).limit(20),
      ])

      const weekPlans = [
        ...(singleDayPlans ?? []),
        ...(rangePlans ?? []),
      ].sort((a, b) => {
        const aDate = (a.date ?? a.start_date) ?? ''
        const bDate = (b.date ?? b.start_date) ?? ''
        return aDate.localeCompare(bDate)
      }).slice(0, 10).map((p) => ({
        id: p.id,
        title: p.title,
        color: p.color,
        date: p.date,
        startDate: p.start_date,
        endDate: p.end_date,
        isCompleted: p.is_completed,
        isAllDay: p.is_all_day,
      }))

      return { completedPlans: completedPlans ?? 0, weekPlans }
    },
    staleTime: HOME_STALE,
    initialData: readStatsCache,
    initialDataUpdatedAt: readStatsCacheTs,
  })

  useEffect(() => {
    if (stats) {
      localStorage.setItem(LS_STATS_KEY, JSON.stringify(stats))
      localStorage.setItem(LS_STATS_TS_KEY, String(Date.now()))
    }
  }, [stats])

  return (
    <HomeClient
      userEmail={userEmail}
      totalMemos={homeMemos?.totalMemos}
      completedPlans={stats?.completedPlans}
      recentMemos={homeMemos?.recentMemos}
      weekPlans={stats?.weekPlans ?? []}
    />
  )
}
