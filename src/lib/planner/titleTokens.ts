/**
 * 플랜 제목 속 [[위키]]·#태그 토큰 — 순수 함수 (2026-11).
 * 데이터는 제목 문자열 그대로 두고, 표시(PlanTitle)·집계(하루 마감·돌아보기)에서 이 함수로 나눈다.
 */

import { wikiKey } from '@/lib/wiki/normalize'

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

/** 위키 칩 목록 정리 — 앞뒤 공백·[[ ]] 제거, 빈 값 제거, 같은 위키(wikiKey 기준) 중복 제거, 최대 MAX_PLAN_WIKIS개 */
export const MAX_PLAN_WIKIS = 5
export function cleanWikiList(list: readonly string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of list) {
    const name = raw.trim().replace(/^\[\[/, '').replace(/\]\]$/, '').trim()
    if (!name) continue
    const k = wikiKey(name)
    if (!k || seen.has(k)) continue
    seen.add(k)
    out.push(name)
    if (out.length >= MAX_PLAN_WIKIS) break
  }
  return out
}

/**
 * 플랜의 위키 — 위키 칩(wikiLinks, 0023)이 기준이고, 예전처럼 제목에 [[위키]]를 직접 쓴 경우도 함께 센다.
 * 하루 마감·돌아보기 집계는 이 함수 하나로만 읽는다.
 */
export function planWikiNames(plan: { title: string; wikiLinks?: readonly string[] | null }): string[] {
  return cleanWikiList([...(plan.wikiLinks ?? []), ...wikiNamesInTitle(plan.title)])
}

/** 빠른 추가 입력의 [[위키]]를 칩으로 떼어 낸다 — '보고서 [[Weave]] 내일' → { title: '보고서 내일', wikis: ['Weave'] } */
export function splitWikisFromText(text: string): { title: string; wikis: string[] } {
  const wikis = cleanWikiList(wikiNamesInTitle(text))
  if (!wikis.length) return { title: text, wikis }
  const title = text.replace(/\[\[[^\]]+\]\]/g, ' ').replace(/\s+/g, ' ').trim()
  // 위키만 적은 경우엔 제목이 비지 않게 위키 이름을 제목으로
  return { title: title || wikis.join(' '), wikis }
}
