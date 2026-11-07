/**
 * 빠른 추가 입력 해석 — "12월 CRM 카피 [[레이비]] 내일 3시" → 제목 + 날짜/시간 (순수 함수).
 *
 * - 날짜: 오늘·내일·모레, (이번 주|다음 주)? X요일, M/D, M월 D일
 * - 시간: (오전|오후)? H시 (M분|반)?, HH:MM — 오전/오후가 없으면 1~7시는 오후, 8~11시는 오전
 * - 길이: N시간 (반)?, N분 — 시간이 있을 때만 해석 (기본 60분). 시간이 없으면 제목에 남긴다
 * - [[위키]]·#태그는 제목에 그대로 남긴다 (표시할 때 칩으로 렌더)
 * 아무 날짜·시간도 없으면 인박스(date=null).
 * 시간만 있고 날짜가 없으면 오늘.
 */

import { format, addDays } from 'date-fns'

export interface QuickAddResult {
  title: string
  date: string | null
  startTime: string | null
  endTime: string | null
  isAllDay: boolean
  /** 칩 표시용 — 해석된 토큰 원문 (제목에서 제거됨) */
  matched: string[]
}

const DOW: Record<string, number> = { 일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6 }

function pad(n: number): string { return String(n).padStart(2, '0') }

/** 단어 경계 — 한글 단어 중간(예: '내일정')을 잘못 잡지 않도록 앞뒤가 공백/문두/문미인지 확인 */
const B = '(?:^|\\s)'
const E = '(?=\\s|$)'
/** 날짜·시간 뒤에 붙는 조사 — '내일 3시에 회의', '금요일까지' (조사는 토큰과 함께 제목에서 빠진다) */
const J = '(?:에|까지|부터)?'

export function parseQuickAdd(input: string, now: Date = new Date()): QuickAddResult {
  let rest = ` ${input.trim()} `
  const matched: string[] = []
  let date: string | null = null
  let startMin: number | null = null
  let durationMin: number | null = null

  const take = (re: RegExp): RegExpMatchArray | null => {
    const m = rest.match(re)
    if (!m) return null
    matched.push(m[0].trim())
    rest = rest.replace(m[0], ' ')
    return m
  }

  // ── 날짜 ──
  let m = take(new RegExp(`${B}(오늘|내일|모레)${J}${E}`))
  if (m) {
    const off = m[1] === '오늘' ? 0 : m[1] === '내일' ? 1 : 2
    date = format(addDays(now, off), 'yyyy-MM-dd')
  }
  if (!date) {
    m = take(new RegExp(`${B}(?:(이번\\s?주|다음\\s?주)\\s?)?([일월화수목금토])요일${J}${E}`))
    if (m) {
      const target = DOW[m[2]]
      const today = now.getDay()
      let off: number
      if (m[1] && m[1].startsWith('다음')) {
        // 다음 주 X요일 = 다음 주(일요일 시작) 안의 X요일
        off = 7 - today + target
      } else if (m[1]) {
        off = target - today // 이번 주 — 지났어도 그 날짜(과거) 그대로
      } else {
        off = (target - today + 7) % 7 // 다가오는 X요일 (오늘이면 오늘)
      }
      date = format(addDays(now, off), 'yyyy-MM-dd')
    }
  }
  if (!date) {
    // 먼저 매칭만 하고, 유효한 날짜일 때만 제목에서 뺀다 (잘못된 날짜는 제목에 그대로)
    const dm = rest.match(new RegExp(`${B}(\\d{1,2})(?:/|월\\s?)(\\d{1,2})일?${J}${E}`))
    if (dm) {
      const mo = Number(dm[1]), d = Number(dm[2])
      let y = now.getFullYear()
      // 60일 넘게 지난 날짜면 내년으로 (12월에 '1/3' → 내년 1/3)
      if (`${y}-${pad(mo)}-${pad(d)}` < format(addDays(now, -60), 'yyyy-MM-dd')) y += 1
      // 실제로 있는 날짜만 (2/31 같은 값은 DB date 저장에서 실패한다)
      const real = new Date(y, mo - 1, d)
      if (mo >= 1 && mo <= 12 && real.getMonth() === mo - 1 && real.getDate() === d) {
        matched.push(dm[0].trim())
        rest = rest.replace(dm[0], ' ')
        date = `${y}-${pad(mo)}-${pad(d)}`
      }
    }
  }

  // ── 시간 — 유효할 때만 제목에서 뺀다 ──
  const consume = (mm: RegExpMatchArray) => { matched.push(mm[0].trim()); rest = rest.replace(mm[0], ' ') }
  const hm = rest.match(new RegExp(`${B}(\\d{1,2}):(\\d{2})${J}${E}`))
  if (hm) {
    const h = Number(hm[1]), mi = Number(hm[2])
    if (h <= 23 && mi <= 59) { startMin = h * 60 + mi; consume(hm) }
  }
  if (startMin === null) {
    const km = rest.match(new RegExp(`${B}(오전|오후)?\\s?(\\d{1,2})시(?:\\s?([0-5]?\\d)분|\\s?(반))?${J}${E}`))
    if (km) {
      let h = Number(km[2])
      const mi = km[3] ? Number(km[3]) : km[4] ? 30 : 0
      if (h <= 23 && mi <= 59) {
        if (km[1] === '오후' && h < 12) h += 12
        else if (km[1] === '오전' && h === 12) h = 0
        else if (!km[1] && h >= 1 && h <= 7) h += 12
        startMin = h * 60 + mi
        consume(km)
      }
    }
  }

  // ── 길이 — 시간이 있을 때만 ('2시간'은 뒤에 '간'이 붙어 시간 정규식에 안 잡힌다) ──
  if (startMin !== null) {
    m = take(new RegExp(`${B}(\\d{1,2})시간(\\s?반)?${E}`))
    if (m) durationMin = Number(m[1]) * 60 + (m[2] ? 30 : 0)
    if (durationMin === null) {
      m = take(new RegExp(`${B}(\\d{2,3})분${E}`))
      if (m) durationMin = Number(m[1])
    }
  }

  const title = rest.replace(/\s+/g, ' ').trim()

  if (startMin === null) {
    return { title: title || input.trim(), date, startTime: null, endTime: null, isAllDay: true, matched }
  }

  const dur = durationMin ?? 60
  const endMin = Math.min(startMin + dur, 24 * 60 - 1)
  return {
    title: title || input.trim(),
    date: date ?? format(now, 'yyyy-MM-dd'),
    startTime: `${pad(Math.floor(startMin / 60))}:${pad(startMin % 60)}`,
    endTime: `${pad(Math.floor(endMin / 60))}:${pad(endMin % 60)}`,
    isAllDay: false,
    matched,
  }
}
