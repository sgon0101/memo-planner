/**
 * RRULE preset 빌더 + 파서 + 한국어 라벨러
 *
 * PlanFormModal(생성/편집) 과 PlanDetailPanel(표시) 둘 다에서 사용.
 *
 * preset 7종 + 맞춤 모드:
 *   - none           : 반복 없음
 *   - daily          : 매일
 *   - weekdays       : 평일만 (월~금)
 *   - weekly         : 매주 같은 요일
 *   - biweekly       : 격주 같은 요일
 *   - monthly-date   : 매월 같은 날짜
 *   - monthly-day    : 매월 같은 N번째 요일 (예: 셋째 월요일)
 *   - yearly         : 매년 같은 날
 *   - custom         : 사용자 정의 (단위/간격/요일/종료조건)
 */

export type RepeatPreset =
  | 'none' | 'daily' | 'weekdays' | 'weekly' | 'biweekly'
  | 'monthly-date' | 'monthly-day' | 'yearly' | 'custom'

export type EndMode = 'forever' | 'count' | 'until'

export type CustomFreq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY'

export interface CustomSettings {
  freq: CustomFreq
  interval: number              // 1 이상
  byday: string[]               // ['MO','WE'] — WEEKLY일 때만 의미 있음
}

export interface RecurrenceSettings {
  preset: RepeatPreset
  endMode: EndMode
  endCount: number              // count 모드일 때
  endUntil: string | null       // until 모드일 때 YYYY-MM-DD
  custom: CustomSettings
}

const WEEKDAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const
const WEEKDAY_KO_SHORT = ['일', '월', '화', '수', '목', '금', '토'] as const

export const ALL_BYDAY: string[] = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']

/** 기본 설정 */
export function defaultRecurrence(): RecurrenceSettings {
  return {
    preset: 'none',
    endMode: 'forever',
    endCount: 10,
    endUntil: null,
    custom: { freq: 'WEEKLY', interval: 1, byday: ['MO'] },
  }
}

/** baseDate('YYYY-MM-DD')의 요일 코드 (예: 'MO') 반환 */
export function weekdayOf(baseDate: string): string {
  const d = new Date(`${baseDate}T12:00:00Z`)
  return WEEKDAY_CODES[d.getUTCDay()]
}

/** baseDate가 그 달에서 몇 번째 같은 요일인지 (1~5) */
export function nthOfMonth(baseDate: string): number {
  const d = new Date(`${baseDate}T12:00:00Z`)
  return Math.ceil(d.getUTCDate() / 7)
}

/** preset + baseDate + 종료조건 → RRULE 문자열 */
export function buildRRule(s: RecurrenceSettings, baseDate: string): string | null {
  if (s.preset === 'none') return null

  const wd = weekdayOf(baseDate)
  const nth = nthOfMonth(baseDate)

  let core: string
  switch (s.preset) {
    case 'daily':         core = 'FREQ=DAILY'; break
    case 'weekdays':      core = 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'; break
    case 'weekly':        core = `FREQ=WEEKLY;BYDAY=${wd}`; break
    case 'biweekly':      core = `FREQ=WEEKLY;INTERVAL=2;BYDAY=${wd}`; break
    case 'monthly-date':  core = 'FREQ=MONTHLY'; break
    case 'monthly-day':   core = `FREQ=MONTHLY;BYDAY=${nth}${wd}`; break
    case 'yearly':        core = 'FREQ=YEARLY'; break
    case 'custom': {
      const parts: string[] = [`FREQ=${s.custom.freq}`]
      if (s.custom.interval > 1) parts.push(`INTERVAL=${s.custom.interval}`)
      if (s.custom.freq === 'WEEKLY' && s.custom.byday.length > 0) {
        parts.push(`BYDAY=${s.custom.byday.join(',')}`)
      }
      core = parts.join(';')
      break
    }
    default: return null
  }

  // 종료 조건 부착
  if (s.endMode === 'count' && s.endCount > 0) {
    core += `;COUNT=${s.endCount}`
  } else if (s.endMode === 'until' && s.endUntil) {
    const u = s.endUntil.replace(/-/g, '')
    core += `;UNTIL=${u}T235959Z`
  }

  return `RRULE:${core}`
}

/** RRULE 문자열을 분석해 preset + endMode 등 복원 (편집 모드) */
export function parseRRule(rruleStr: string | null, baseDate: string): RecurrenceSettings {
  const init = defaultRecurrence()
  if (!rruleStr) return init

  const s = rruleStr.trim().toUpperCase().replace(/^RRULE:/, '')
  const parts = Object.fromEntries(
    s.split(';').map((kv) => {
      const [k, v] = kv.split('=')
      return [k, v]
    }),
  ) as Record<string, string>

  const freq = parts.FREQ
  const interval = parts.INTERVAL ? parseInt(parts.INTERVAL, 10) : 1
  const byday = parts.BYDAY ? parts.BYDAY.split(',') : []

  // 종료 조건
  let endMode: EndMode = 'forever'
  let endCount = init.endCount
  let endUntil: string | null = null
  if (parts.COUNT) {
    endMode = 'count'
    endCount = parseInt(parts.COUNT, 10)
  } else if (parts.UNTIL) {
    endMode = 'until'
    // 20260701T235959Z → 2026-07-01
    const u = parts.UNTIL
    endUntil = `${u.slice(0, 4)}-${u.slice(4, 6)}-${u.slice(6, 8)}`
  }

  // preset detect
  const wd = weekdayOf(baseDate)
  let preset: RepeatPreset = 'custom'
  const bydayOnly = byday.map((d) => d.replace(/^[-]?\d+/, ''))

  if (freq === 'DAILY' && interval === 1 && byday.length === 0) preset = 'daily'
  else if (freq === 'WEEKLY' && interval === 1
           && bydayOnly.length === 5
           && ['MO','TU','WE','TH','FR'].every((d) => bydayOnly.includes(d))) preset = 'weekdays'
  else if (freq === 'WEEKLY' && interval === 1
           && bydayOnly.length === 1 && bydayOnly[0] === wd) preset = 'weekly'
  else if (freq === 'WEEKLY' && interval === 2
           && bydayOnly.length === 1 && bydayOnly[0] === wd) preset = 'biweekly'
  else if (freq === 'MONTHLY' && interval === 1 && byday.length === 0) preset = 'monthly-date'
  else if (freq === 'MONTHLY' && interval === 1
           && byday.length === 1
           && /^[1-5][A-Z]{2}$/.test(byday[0])) preset = 'monthly-day'
  else if (freq === 'YEARLY' && interval === 1 && byday.length === 0) preset = 'yearly'

  // custom 설정 복원
  const customFreq: CustomFreq =
    freq === 'DAILY' || freq === 'WEEKLY' || freq === 'MONTHLY' || freq === 'YEARLY'
      ? (freq as CustomFreq)
      : 'WEEKLY'

  return {
    preset,
    endMode,
    endCount,
    endUntil,
    custom: {
      freq: customFreq,
      interval,
      byday: byday.length > 0 ? bydayOnly : [wd],
    },
  }
}

/** RRULE 문자열을 사람이 읽기 좋은 한국어로 변환 (PlanDetailPanel용) */
export function describeRRule(rruleStr: string | null, baseDate: string | null): string {
  if (!rruleStr) return ''
  const s = parseRRule(rruleStr, baseDate ?? '2026-01-01')

  let label: string
  switch (s.preset) {
    case 'daily':         label = '매일 반복'; break
    case 'weekdays':      label = '평일마다 반복 (월~금)'; break
    case 'weekly': {
      const wd = baseDate ? weekdayKo(baseDate) : ''
      label = `매주 ${wd}요일`
      break
    }
    case 'biweekly': {
      const wd = baseDate ? weekdayKo(baseDate) : ''
      label = `격주 ${wd}요일`
      break
    }
    case 'monthly-date': {
      const dom = baseDate ? new Date(`${baseDate}T12:00:00Z`).getUTCDate() : ''
      label = `매월 ${dom}일`
      break
    }
    case 'monthly-day': {
      const nth = baseDate ? nthOfMonth(baseDate) : 1
      const wd = baseDate ? weekdayKo(baseDate) : ''
      const nthKo = ['', '첫째', '둘째', '셋째', '넷째', '다섯째'][nth] || `${nth}번째`
      label = `매월 ${nthKo} ${wd}요일`
      break
    }
    case 'yearly': {
      const md = baseDate ? formatMd(baseDate) : ''
      label = `매년 ${md}`
      break
    }
    case 'custom': {
      const freqKo = { DAILY: '일', WEEKLY: '주', MONTHLY: '월', YEARLY: '년' }[s.custom.freq]
      const interval = s.custom.interval > 1 ? `${s.custom.interval}` : ''
      label = `${interval}${freqKo}마다`
      if (s.custom.freq === 'WEEKLY' && s.custom.byday.length > 0) {
        const days = s.custom.byday.map(bydayToKo).join('·')
        label += ` (${days})`
      }
      break
    }
    default: return ''
  }

  // 종료 조건 부착
  if (s.endMode === 'count') {
    label += ` · ${s.endCount}회`
  } else if (s.endMode === 'until' && s.endUntil) {
    label += ` · ${s.endUntil}까지`
  }

  return label
}

/** 기존 RRULE 문자열에 UNTIL을 설정/교체. COUNT는 함께 제거됨 (서로 배타). */
export function setUntilOnRRule(rruleStr: string, untilDate: string): string {
  const u = untilDate.replace(/-/g, '')  // 20260730
  // 기존 UNTIL/COUNT 제거 (앞 세미콜론까지 같이)
  let cleaned = rruleStr
    .replace(/;UNTIL=[^;]+/gi, '')
    .replace(/;COUNT=[^;]+/gi, '')
    .replace(/^UNTIL=[^;]+;?/i, '')
    .replace(/^COUNT=[^;]+;?/i, '')
  // 새 UNTIL 부착
  if (cleaned.endsWith(';')) cleaned = cleaned.slice(0, -1)
  cleaned += `;UNTIL=${u}T235959Z`
  return cleaned
}

function weekdayKo(baseDate: string): string {
  const d = new Date(`${baseDate}T12:00:00Z`)
  return WEEKDAY_KO_SHORT[d.getUTCDay()]
}

function bydayToKo(byday: string): string {
  // '2MO' 같은 prefix 제거
  const code = byday.replace(/^[-]?\d+/, '')
  const idx = WEEKDAY_CODES.indexOf(code as typeof WEEKDAY_CODES[number])
  return idx >= 0 ? WEEKDAY_KO_SHORT[idx] : code
}

function formatMd(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00Z`)
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일`
}
