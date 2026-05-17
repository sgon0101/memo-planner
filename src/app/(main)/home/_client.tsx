'use client'

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { startOfWeek, endOfWeek, format as fmtDate } from 'date-fns'
import { createClient } from '@/lib/supabase/client'
import { memoKeys, readLocalCache, readLocalCacheTs } from '@/hooks/useMemos'
import type { Memo } from '@/types'
import HomeClient from '@/components/home/HomeClient'

const HOME_STALE = 5 * 60 * 1000

// 홈 전용 메모 캐시 (최근 5개) — count 쿼리 없음
const LS_HOME_MEMOS_KEY = 'home-memos-cache'
const LS_HOME_MEMOS_TS_KEY = 'home-memos-cache-ts'
const LS_STATS_KEY = 'home-stats-cache'
const LS_STATS_TS_KEY = 'home-stats-cache-ts'

interface HomeMemos {
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
  // 전체 메모 캐시 구독 (MemoListPrefetch가 레이아웃에서 채움)
  // enabled: false → 직접 fetch 없이 캐시 변경 시에만 반응
  // initialData: localStorage에서 즉시 복원 → 이전 세션 값 즉각 표시
  // 이전 방문 시 저장된 개수를 즉시 읽어 표시 (prefetch 완료 전에도 표시)
  // 1순위: memos-total-count (직접 저장된 카운트, 최신 배포 이후)
  // 2순위: memos-all-cache length (메모 목록 방문 시 저장, 기기 간 호환)
  const [prevCount] = useState<number | undefined>(() => {
    if (typeof window === 'undefined') return undefined
    try {
      const countStr = localStorage.getItem('memos-total-count')
      if (countStr !== null) return Number(countStr)
      const raw = localStorage.getItem('memos-all-cache')
      if (!raw) return undefined
      const arr = JSON.parse(raw) as unknown[]
      return Array.isArray(arr) && arr.length > 0 ? arr.length : undefined
    } catch { return undefined }
  })

  // 전체 메모 캐시 구독 (MemoListPrefetch·SSR이 채우면 자동 반영)
  const { data: allMemos } = useQuery<Memo[]>({
    queryKey: memoKeys.all(),
    queryFn: () => Promise.resolve([] as Memo[]),
    enabled: false,
    initialData: readLocalCache,
    initialDataUpdatedAt: readLocalCacheTs,
  })
  // allMemos 로드 전에는 prevCount(이전 방문 저장값)로 즉각 표시
  const totalMemos = allMemos?.length ?? prevCount

  // 홈 전용 경량 쿼리 — 최근 5개만 (count 없음, 단일 요청)
  const { data: homeMemos } = useQuery<HomeMemos>({
    queryKey: ['home-memos'],
    queryFn: async (): Promise<HomeMemos> => {
      const supabase = createClient()
      const { data: recent } = await supabase
        .from('memos')
        .select('id, title, content_text, updated_at, is_starred, is_pinned')
        .eq('is_deleted', false)
        .order('updated_at', { ascending: false })
        .limit(5)
      return {
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
      totalMemos={totalMemos}
      completedPlans={stats?.completedPlans}
      recentMemos={homeMemos?.recentMemos}
      weekPlans={stats?.weekPlans ?? []}
    />
  )
}
