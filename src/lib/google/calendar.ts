import { google } from 'googleapis'

export function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID!,
    process.env.GOOGLE_CLIENT_SECRET!,
    `${process.env.NEXTAUTH_URL}/api/calendar/callback`
  )
}

export function getAuthUrl(state: string) {
  const client = getOAuthClient()
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/calendar'],
    state,
  })
}

export async function getCalendarClient(accessToken: string, refreshToken: string) {
  const client = getOAuthClient()
  client.setCredentials({ access_token: accessToken, refresh_token: refreshToken })
  return google.calendar({ version: 'v3', auth: client })
}

export function planToGoogleEvent(plan: {
  title: string
  date?: string | null
  startDate?: string | null
  endDate?: string | null
  startTime?: string | null
  endTime?: string | null
  isAllDay?: boolean
  color?: string
}) {
  const isRange = !!(plan.startDate && plan.endDate)
  const dateStr = isRange ? plan.startDate! : plan.date!
  const endDateStr = isRange ? plan.endDate! : plan.date!

  if (plan.isAllDay) {
    // 종일 이벤트: end date는 exclusive이므로 +1일
    const endExclusive = new Date(endDateStr)
    endExclusive.setDate(endExclusive.getDate() + 1)
    return {
      summary: plan.title,
      start: { date: dateStr },
      end: { date: endExclusive.toISOString().slice(0, 10) },
    }
  }

  const startDt = `${dateStr}T${plan.startTime ?? '00:00'}:00`

  // 자정 종료(24:00)는 ISO에 없는 표기 — 다음날 00:00으로 변환 (Google API 호환)
  let endTimeStr = plan.endTime ?? plan.startTime ?? '00:00'
  let endDateForDt = endDateStr
  if (endTimeStr.startsWith('24')) {
    endTimeStr = '00:00'
    const next = new Date(`${endDateStr}T12:00:00Z`) // UTC noon — DST 안전
    next.setUTCDate(next.getUTCDate() + 1)
    endDateForDt = next.toISOString().slice(0, 10)
  }
  const endDt = `${endDateForDt}T${endTimeStr}:00`

  return {
    summary: plan.title,
    start: { dateTime: startDt, timeZone: 'Asia/Seoul' },
    end: { dateTime: endDt, timeZone: 'Asia/Seoul' },
  }
}
