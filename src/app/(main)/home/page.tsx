import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import HomeClient from '@/components/home/HomeClient'

export default async function HomePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // 통계 데이터
  const now = new Date()
  const todayStr = now.toISOString().slice(0, 10)
  const weekLaterStr = new Date(now.getTime() + 7 * 86400000).toISOString().slice(0, 10)

  const [{ count: totalMemos }, { count: completedPlans }, { data: recentMemos }, { data: weekPlans }] =
    await Promise.all([
      supabase.from('memos').select('*', { count: 'exact', head: true })
        .eq('user_id', user.id).eq('is_deleted', false),
      supabase.from('plans').select('*', { count: 'exact', head: true })
        .eq('user_id', user.id).eq('is_completed', true),
      supabase.from('memos').select('id, title, content_text, updated_at, is_starred, is_pinned')
        .eq('user_id', user.id).eq('is_deleted', false)
        .order('updated_at', { ascending: false }).limit(5),
      supabase.from('plans').select('id, title, color, date, start_date, end_date, is_completed, is_all_day')
        .eq('user_id', user.id)
        .gte('date', todayStr)
        .lte('date', weekLaterStr)
        .order('date', { ascending: true }).limit(10),
    ])

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
      weekPlans={(weekPlans ?? []).map((p) => ({
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
