import type { Plan } from '@/types'

export interface RangeBarItem {
  plan: Plan
  startCol: number // 0–6 (주 내 시작 컬럼)
  endCol: number   // 0–6 (주 내 끝 컬럼)
  slot: number     // 세로 슬롯 (0, 1, 2...)
}

/**
 * 주(7일) 단위 범위 플랜 바 레이아웃 — 월뷰 그리드·주뷰 종일 레인 공용.
 *
 * 2026-08-09 이전엔 월뷰(CalendarView)와 주뷰(WeekView)가 각자 슬롯 로직을
 * 들고 있었고, 월뷰만 2026-08 "자리가 남는데도 누락" 버그가 고쳐진 상태였다
 * (시작일 정렬 + 줄 수 기준 상한 + hidden 카운트). 주뷰 종일 레인은 여전히
 * 구버전(정렬 없음 + 개수 기준 slice)이라 슬롯 재사용이 어긋나고 겹치지 않는
 * 플랜까지 통째로 숨는 패턴이 남아 있었다 → 단일 출처로 통합.
 *
 * 규칙:
 * - maxSlots는 "겹치는 플랜 수"가 아니라 "차지하는 줄 수" 상한이다.
 *   개수로 먼저 자르면 같은 줄에 나란히 놓일 수 있는 플랜까지 사라진다.
 * - greedy 슬롯 할당은 시작일 순서를 전제로 한다. 유입 순서로는 슬롯
 *   재사용이 어긋나 줄 수가 불필요하게 늘어난다. 동률은 id로 안정 정렬.
 */
export function computeRangeBars(
  dayStrs: string[],
  plans: Plan[],
  maxSlots: number,
): { bars: RangeBarItem[]; hidden: number } {
  const rangeStart = dayStrs[0]
  const rangeEnd = dayStrs[dayStrs.length - 1]

  const overlapping = plans
    .filter((p) => p.startDate && p.endDate)
    .filter((p) => p.startDate! <= rangeEnd && p.endDate! >= rangeStart)
    .sort((a, b) => {
      const s = a.startDate! < b.startDate! ? -1 : a.startDate! > b.startDate! ? 1 : 0
      return s !== 0 ? s : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })

  const slotEnds: string[] = [] // slotEnds[i] = 해당 슬롯의 마지막 날짜
  const bars: RangeBarItem[] = []
  let hidden = 0

  for (const plan of overlapping) {
    const visStart = plan.startDate! < rangeStart ? rangeStart : plan.startDate!
    const visEnd = plan.endDate! > rangeEnd ? rangeEnd : plan.endDate!
    const startCol = dayStrs.indexOf(visStart)
    const endCol = dayStrs.indexOf(visEnd)

    // 빈 슬롯 찾기
    let slot = slotEnds.findIndex((end) => end < visStart)
    if (slot === -1) slot = slotEnds.length

    // 줄 수 상한을 넘는 것만 숨기고, 숨겼다는 사실은 hidden으로 남긴다
    if (slot >= maxSlots) { hidden++; continue }
    slotEnds[slot] = visEnd

    bars.push({ plan, startCol, endCol, slot })
  }

  return { bars, hidden }
}
