/**
 * 플랜 제목 속 [[위키]]·#태그 토큰 — 순수 함수 (2026-11).
 * 데이터는 제목 문자열 그대로 두고, 표시(PlanTitle)·집계(하루 마감·돌아보기)에서 이 함수로 나눈다.
 */

const TOKEN = /(\[\[[^\]]+\]\]|#[^\s#[\]]+)/g

export function splitPlanTitle(title: string): { text: string; kind: 'text' | 'wiki' | 'tag' }[] {
  return title.split(TOKEN).filter(Boolean).map((part) => {
    if (part.startsWith('[[') && part.endsWith(']]')) return { text: part.slice(2, -2), kind: 'wiki' as const }
    if (part.startsWith('#') && part.length > 1) return { text: part.slice(1), kind: 'tag' as const }
    return { text: part, kind: 'text' as const }
  })
}

/** 위키 이름 목록 (하루 마감·돌아보기 집계용) */
export function wikiNamesInTitle(title: string): string[] {
  return splitPlanTitle(title).filter((p) => p.kind === 'wiki').map((p) => p.text.trim()).filter(Boolean)
}

/** 좁은 자리(캘린더 블록·목록·토스트)용 — [[위키]]의 괄호만 걷어낸 제목. #태그는 그대로 */
export function plainTitle(title: string): string {
  return title.replace(/\[\[([^\]]+)\]\]/g, '$1')
}
