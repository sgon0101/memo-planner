import { redirect } from 'next/navigation'
import { startOfWeek, endOfWeek, format as fmtDate } from 'date-fns'
import { createClient } from '@/lib/supabase/server'
import HomeClient from '@/components/home/HomeClient'

export default async function HomePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const now = new Date()
  // 이번 주 월~일 (한국/국제 기준 월요일 시작)
  const weekStart = fmtDate(startOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd')
  const weekEnd   = fmtDate(endOfWeek(now,   { weekStartsOn: 1 }), 'yyyy-MM-dd')

  const [
    { count: totalMemos },
    { count: completedPlans },
    { data: recentMemos },
    { data: singleDayPlans },
    { data: rangePlans },
  ] = await Promise.all([
    supabase.from('memos').select('*', { count: 'exact', head: true })
      .eq('user_id', user.id).eq('is_deleted', false),
    supabase.from('plans').select('*', { count: 'exact', head: true })
      .eq('user_id', user.id).eq('is_completed', true),
    supabase.from('memos').select('id, title, content_text, updated_at, is_starred, is_pinned')
      .eq('user_id', user.id).eq('is_deleted', false)
      .order('updated_at', { ascending: false }).limit(5),
    // 단일 날짜 플랜 (date 컬럼 기준)
    supabase.from('plans')
      .select('id, title, color, date, start_date, end_date, is_completed, is_all_day')
      .eq('user_id', user.id)
      .gte('date', weekStart)
      .lte('date', weekEnd)
      .order('date', { ascending: true })
      .limit(20),
    // 범위 플랜 (start_date/end_date 기준, date is null)
    supabase.from('plans')
      .select('id, title, color, date, start_date, end_date, is_completed, is_all_day')
      .eq('user_id', user.id)
      .is('date', null)
      .lte('start_date', weekEnd)
      .gte('end_date', weekStart)
      .order('start_date', { ascending: true })
      .limit(20),
  ])

  // 단일 + 범위 플랜 합산 후 날짜순 정렬
  const combinedWeekPlans = [
    ...(singleDayPlans ?? []),
    ...(rangePlans ?? []),
  ].sort((a, b) => {
    const aDate = (a.date ?? a.start_date) ?? ''
    const bDate = (b.date ?? b.start_date) ?? ''
    return aDate.localeCompare(bDate)
  }).slice(0, 10)

  return (
    <HomeClient
      userEmail={user.email ?? ''}
      totalMemos={totalMemos ?? 0}
      completedPlans={completedPlans ?? 0}
      recentMemos={(recentMemos ?? []).map((m) => ({
        id: m.id,
        title: m.title ?? '',
        contentText: m.content_text ?? '',
        updatedAt: m.updated_at,
        isStarred: m.is_starred,
        isPinned: m.is_pinned,
      }))}
      weekPlans={combinedWeekPlans.map((p) => ({
        id: p.id,
        title: p.title,
        color: p.color,
        date: p.date,
        startDate: p.start_date,
        endDate: p.end_date,
        isCompleted: p.is_completed,
        isAllDay: p.is_all_day,
      }))}
    />
  )
}
