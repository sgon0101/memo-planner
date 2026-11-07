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
}, opts: { busyOnly?: boolean } = {}) {
  // '바쁨으로만 보내기' — 제목 대신 고정 문구 (공유 캘린더에 내용이 드러나지 않게)
  const summary = opts.busyOnly ? 'Weave 일정' : plan.title
  const isRange = !!(plan.startDate && plan.endDate)
  const dateStr = isRange ? plan.startDate! : plan.date!
  const endDateStr = isRange ? plan.endDate! : plan.date!

  if (plan.isAllDay) {
    // 종일 이벤트: end date는 exclusive이므로 +1일
    const endExclusive = new Date(endDateStr)
    endExclusive.setDate(endExclusive.getDate() + 1)
    return {
      summary,
      start: { date: dateStr },
      end: { date: endExclusive.toISOString().slice(0, 10) },
    }
  }

  // DB time 컬럼은 'HH:MM:SS'로 온다 — 그대로 ':00'을 붙이면 'T09:00:00:00'(무효)이 되어
  // 시간 지정 플랜이 전부 Google API에서 거절되고 조용히 건너뛰어졌다 (2026-11 수정)
  const hhmm = (t: string) => t.slice(0, 5)
  const startDt = `${dateStr}T${hhmm(plan.startTime ?? '00:00')}:00`

  // 자정 종료(24:00)는 ISO에 없는 표기 — 다음날 00:00으로 변환 (Google API 호환)
  let endTimeStr = hhmm(plan.endTime ?? plan.startTime ?? '00:00')
  let endDateForDt = endDateStr
  if (endTimeStr.startsWith('24')) {
    endTimeStr = '00:00'
    const next = new Date(`${endDateStr}T12:00:00Z`) // UTC noon — DST 안전
    next.setUTCDate(next.getUTCDate() + 1)
    endDateForDt = next.toISOString().slice(0, 10)
  }
  const endDt = `${endDateForDt}T${endTimeStr}:00`

  return {
    summary,
    start: { dateTime: startDt, timeZone: 'Asia/Seoul' },
    end: { dateTime: endDt, timeZone: 'Asia/Seoul' },
  }
}

/**
 * Google로 보낼 플랜 고르기 (2026-11). 보내지 않는 것:
 * - 인박스(날짜·기간 없음) — 넣을 자리가 없다
 * - 완료한 플랜, 이미 지난 플랜 — 연결 직후 과거 기록이 캘린더에 쏟아지는 것 방지
 * - 반복 플랜 — 이 동기화는 반복 규칙을 보내지 않아 첫 회차 하나만 생기는 틀린 일정이 된다
 */
export function selectPlansForGoogleSync<T extends {
  date: string | null; start_date: string | null; end_date: string | null
  is_completed: boolean; repeat_type: string | null; rrule_str: string | null
}>(rows: T[], today: string): T[] {
  return rows.filter((r) => {
    if (r.is_completed) return false
    if (r.repeat_type || r.rrule_str) return false
    if (r.date) return r.date >= today
    if (r.start_date && r.end_date) return r.end_date >= today
    return false
  })
}
