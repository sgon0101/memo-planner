'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { startOfWeek, endOfWeek, format as fmtDate } from 'date-fns'
import { createClient } from '@/lib/supabase/client'
import { useMemos } from '@/hooks/useMemos'
import HomeClient from '@/components/home/HomeClient'

const HOME_STALE = 5 * 60 * 1000

export default function HomePageClient() {
  const { memos, isLoading, isFetching } = useMemos(undefined)
  // 데이터가 실제로 준비됐는지 확인 — 로딩 중 0/빈값 표시 방지
  const memosReady = !isLoading && !(isFetching && memos.length === 0)

  // 메모 캐시에서 즉각 계산 — 서버 왕복 없음
  const totalMemos = memosReady ? memos.length : undefined
  const recentMemos = useMemo(() => {
    if (!memosReady) return undefined
    return [...memos]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 5)
      .map((m) => ({
        id: m.id,
        title: m.title,
        contentText: m.contentText,
        updatedAt: m.updatedAt,
        isStarred: m.isStarred,
        isPinned: m.isPinned,
      }))
  }, [memos, memosReady])

  // 사용자 이메일 — Supabase 클라이언트 세션에서 즉각 (로컬 토큰)
  const { data: userEmail = '' } = useQuery({
    queryKey: ['user-email'],
    queryFn: async () => {
      const { data: { user } } = await createClient().auth.getUser()
      return user?.email ?? ''
    },
    staleTime: Infinity,
  })

  // 플랜 통계 — 클라이언트 fetch + 5분 캐시
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
  })

  return (
    <HomeClient
      userEmail={userEmail}
      totalMemos={totalMemos}
      completedPlans={stats?.completedPlans ?? 0}
      recentMemos={recentMemos}
      weekPlans={stats?.weekPlans ?? []}
    />
  )
}
