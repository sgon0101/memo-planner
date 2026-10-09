import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCalendarClient, planToGoogleEvent } from '@/lib/google/calendar'
import { getIntegrationTokens } from '@/lib/google/integrationTokens'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 저장된 토큰 조회 (서버 전용·복호화)
  const integration = await getIntegrationTokens(user.id, 'google_calendar')

  if (!integration?.accessToken) {
    return NextResponse.json({ error: 'Google Calendar not connected' }, { status: 400 })
  }

  const calendar = await getCalendarClient(integration.accessToken, integration.refreshToken ?? '')

  // 아직 동기화되지 않은 플랜 조회 (google_event_id가 없는 것)
  const { data: plans } = await supabase
    .from('plans')
    .select('*')
    .eq('user_id', user.id)
    .is('google_event_id', null)

  let synced = 0
  for (const plan of plans ?? []) {
    try {
      const event = planToGoogleEvent({
        title: plan.title,
        date: plan.date,
        startDate: plan.start_date,
        endDate: plan.end_date,
        startTime: plan.start_time,
        endTime: plan.end_time,
        isAllDay: plan.is_all_day,
      })

      const { data: created } = await calendar.events.insert({
        calendarId: 'primary',
        requestBody: event,
      })

      if (created?.id) {
        await supabase.from('plans').update({ google_event_id: created.id }).eq('id', plan.id)
        synced++
      }
    } catch {
      // 개별 이벤트 실패는 건너뜀
    }
  }

  return NextResponse.json({ synced })
}
