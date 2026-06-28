'use client'

import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { startOfWeek, endOfWeek, format as fmtDate } from 'date-fns'
import { createClient } from '@/lib/supabase/client'
import { memoKeys, readLocalCache, readLocalCacheTs } from '@/hooks/useMemos'
import type { Memo } from '@/types'
import HomeClient from '@/components/home/HomeClient'
// PR-4: namespaced LS keys
import {
  lsHomeMemosCache, lsHomeMemosCacheTs,
  lsHomeStatsCache, lsHomeStatsCacheTs,
  lsMemosCache, lsMemosTotalCount,
} from '@/lib/cache/lsKeys'
import { subscribeUserId } from '@/lib/auth/currentUser'

const HOME_STALE = 5 * 60 * 1000

// 홈 전용 메모 캐시 (최근 5개) — count 쿼리 없음

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

interface DdayPlan {
  id: string
  title: string
  color: string
  ddayTarget: string
}

function readHomeMemoCache(): HomeMemos | undefined {
  if (typeof window === 'undefined') return undefined
  try {
    const v = (() => { const k = lsHomeMemosCache(); return k ? localStorage.getItem(k) : null })()
    return v ? (JSON.parse(v) as HomeMemos) : undefined
  } catch { return undefined }
}

function readHomeMemoTs(): number {
  if (typeof window === 'undefined') return 0
  try {
    const v = (() => { const k = lsHomeMemosCacheTs(); return k ? localStorage.getItem(k) : null })()
    return v ? parseInt(v, 10) : 0
  } catch { return 0 }
}

function readStatsCache() {
  if (typeof window === 'undefined') return undefined
  try {
    const v = (() => { const k = lsHomeStatsCache(); return k ? localStorage.getItem(k) : null })()
    return v ? JSON.parse(v) : undefined
  } catch { return undefined }
}

function readStatsCacheTs(): number {
  if (typeof window === 'undefined') return 0
  try {
    const v = (() => { const k = lsHomeStatsCacheTs(); return k ? localStorage.getItem(k) : null })()
    return v ? parseInt(v, 10) : 0
  } catch { return 0 }
}

export default function HomePageClient() {
  const queryClient = useQueryClient()

  // 전체 메모 캐시 구독 (MemoListPrefetch가 레이아웃에서 채움)
  // enabled: false → 직접 fetch 없이 캐시 변경 시에만 반응
  // initialData: localStorage에서 즉시 복원 → 이전 세션 값 즉각 표시
  // 이전 방문 시 저장된 개수를 즉시 읽어 표시 (prefetch 완료 전에도 표시)
  // 1순위: memos-total-count (직접 저장된 카운트, 최신 배포 이후)
  // 2순위: memos-all-cache length (메모 목록 방문 시 저장, 기기 간 호환)
  const [prevCount, setPrevCount] = useState<number | undefined>(() => {
    if (typeof window === 'undefined') return undefined
    try {
      const countStr = (() => { const k = lsMemosTotalCount(); return k ? localStorage.getItem(k) : null })()
      if (countStr !== null) return Number(countStr)
      const raw = (() => { const k = lsMemosCache(); return k ? localStorage.getItem(k) : null })()
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
      { const k = lsHomeMemosCache(); const kts = lsHomeMemosCacheTs(); if (k && kts) { localStorage.setItem(k, JSON.stringify(homeMemos)); localStorage.setItem(kts, String(Date.now())) } }
    }
  }, [homeMemos])

  // 표시 이름 — 닉네임(display_name) 우선, 없으면 이메일 앞부분
  const { data: userName = '' } = useQuery({
    queryKey: ['user-name'],
    queryFn: async () => {
      const { data: { user } } = await createClient().auth.getUser()
      return (user?.user_metadata?.display_name as string | undefined)
        || user?.email?.split('@')[0]
        || ''
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
    // usePlanner mutation들이 ['home-stats']를 invalidate하므로 매 방문 refetch 불필요
    staleTime: HOME_STALE,
    initialData: readStatsCache,
    initialDataUpdatedAt: readStatsCacheTs,
  })

  useEffect(() => {
    if (stats) {
      { const k = lsHomeStatsCache(); const kts = lsHomeStatsCacheTs(); if (k && kts) { localStorage.setItem(k, JSON.stringify(stats)); localStorage.setItem(kts, String(Date.now())) } }
    }
  }, [stats])

  // ★ userId reactive 복원 — userId가 async로 늦게 들어오면 mount 시점 useState/useQuery
  // initialData가 모두 null 키로 localStorage를 못 읽어 0.몇초 빈 화면이 보이던 회귀 fix.
  // subscribeUserId로 userId 들어오자마자 캐시를 즉시 채워 화면 갱신.
  useEffect(() => {
    return subscribeUserId((uid) => {
      if (!uid) return
      try {
        // 1) totalMemos
        if (prevCount === undefined) {
          const k = lsMemosTotalCount()
          if (k) {
            const v = localStorage.getItem(k)
            if (v !== null) setPrevCount(Number(v))
          }
          if (prevCount === undefined) {
            const ck = lsMemosCache()
            if (ck) {
              const raw = localStorage.getItem(ck)
              if (raw) {
                const arr = JSON.parse(raw) as unknown[]
                if (Array.isArray(arr) && arr.length > 0) setPrevCount(arr.length)
              }
            }
          }
        }
        // 2) home-memos 캐시 즉시 복원
        const homeData = readHomeMemoCache()
        if (homeData) queryClient.setQueryData(['home-memos'], homeData)
        // 3) home-stats 캐시 즉시 복원
        const statsData = readStatsCache()
        if (statsData) queryClient.setQueryData(['home-stats'], statsData)
        // 4) allMemos 캐시 (memos-all)
        const allMemosData = readLocalCache()
        if (allMemosData) queryClient.setQueryData(memoKeys.all(), allMemosData)
      } catch { /* ignore */ }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryClient])

  // 다가오는 D-day — 미래(또는 오늘) 8개
  const { data: ddayPlans = [] } = useQuery<DdayPlan[]>({
    queryKey: ['home-dday'],
    queryFn: async () => {
      const supabase = createClient()
      const today = fmtDate(new Date(), 'yyyy-MM-dd')
      const { data } = await supabase
        .from('plans')
        .select('id, title, color, dday_target')
        .not('dday_target', 'is', null)
        .gte('dday_target', today)
        .order('dday_target', { ascending: true })
        .limit(8)
      return (data ?? []).map((p) => ({
        id: p.id as string,
        title: p.title as string,
        color: (p.color as string) ?? '#7F77DD',
        ddayTarget: p.dday_target as string,
      }))
    },
    staleTime: HOME_STALE,
  })

  return (
    <HomeClient
      userName={userName}
      totalMemos={totalMemos}
      completedPlans={stats?.completedPlans}
      recentMemos={homeMemos?.recentMemos}
      weekPlans={stats?.weekPlans ?? []}
      ddayPlans={ddayPlans}
    />
  )
}
