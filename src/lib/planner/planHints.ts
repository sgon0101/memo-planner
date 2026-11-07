/**
 * 위키·색상 추천 (2026-11) — 지난 플랜에서 배운다. 순수 함수, 단위 테스트 대상.
 * - 색상: 그 위키를 단 플랜에서 가장 많이 쓴 색
 * - 위키: 제목이 같거나 낱말이 겹치는 지난 플랜의 위키 (예: '크로스핏 저녁' → 운동)
 */

import { wikiKey } from '@/lib/wiki/normalize'

export interface HintPlan { title: string; color: string; wikiLinks: string[] }

export interface PlanHints {
  wikiColor: Map<string, string>
  plans: { tokens: string[]; norm: string; wikis: string[] }[]
}

// 어떤 일에도 붙는 말 — 이것만 겹쳐서는 추천하지 않는다
const STOP = new Set(['준비', '정리', '작업', '체크', '하기', '확인', '업데이트', '제출', '업로드', '진행', '계획', '오늘', '내일'])

export function titleTokens(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/\[\[|\]\]/g, ' ')
    .split(/[^0-9a-z가-힣]+/)
    .filter((t) => t.length >= 2 && !STOP.has(t) && !/^\d+$/.test(t) && !/^\d+편$/.test(t))
}

const norm = (t: string) => titleTokens(t).join(' ')

export function buildPlanHints(plans: readonly HintPlan[]): PlanHints {
  const colorCount = new Map<string, Map<string, number>>()
  const out: PlanHints['plans'] = []
  for (const p of plans) {
    if (!p.wikiLinks?.length) continue
    for (const w of p.wikiLinks) {
      const k = wikiKey(w)
      const m = colorCount.get(k) ?? new Map<string, number>()
      m.set(p.color, (m.get(p.color) ?? 0) + 1)
      colorCount.set(k, m)
    }
    out.push({ tokens: titleTokens(p.title), norm: norm(p.title), wikis: p.wikiLinks })
  }
  const wikiColor = new Map<string, string>()
  for (const [k, m] of colorCount) {
    const best = [...m.entries()].sort((a, b) => b[1] - a[1])[0]
    if (best) wikiColor.set(k, best[0])
  }
  return { wikiColor, plans: out }
}

/** 위키에 어울리는 색 (지난 플랜에서 가장 많이 쓴 색) */
export function colorForWiki(hints: PlanHints, wiki: string): string | null {
  return hints.wikiColor.get(wikiKey(wiki)) ?? null
}

function tokenMatch(a: string, b: string): boolean {
  if (a === b) return true
  // '운동하기'↔'운동', '크로스핏'↔'크로스핏' — 2글자 이상 접두 포함만 (중간 포함은 오탐이 많다)
  return (a.length >= 2 && b.startsWith(a)) || (b.length >= 2 && a.startsWith(b))
}

/**
 * 제목으로 위키 추천 — 같은 제목(정규화)이면 가장 강하게, 아니면 겹치는 낱말 수.
 * 최고 점수인 위키만 (최대 limit개), 이미 고른 위키는 뺀다.
 */
export function suggestWikis(hints: PlanHints, title: string, chosen: readonly string[] = [], limit = 2): string[] {
  const tokens = titleTokens(title)
  if (!tokens.length) return []
  const n = norm(title)
  const chosenKeys = new Set(chosen.map(wikiKey))
  const score = new Map<string, { name: string; s: number; hits: number }>()
  for (const p of hints.plans) {
    let s = 0
    if (p.norm && p.norm === n) s = 100
    else for (const t of tokens) if (p.tokens.some((u) => tokenMatch(t, u))) s += 1
    if (s === 0) continue
    for (const w of p.wikis) {
      const k = wikiKey(w)
      if (chosenKeys.has(k)) continue
      const cur = score.get(k)
      if (!cur || s > cur.s) score.set(k, { name: w, s, hits: 1 })
      else if (s === cur.s) cur.hits += 1
    }
  }
  const ranked = [...score.values()].sort((a, b) => b.s - a.s || b.hits - a.hits)
  if (!ranked.length) return []
  const top = ranked[0].s
  return ranked.filter((r) => r.s === top).slice(0, limit).map((r) => r.name)
}
