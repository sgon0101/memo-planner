/**
 * 메모 검색어 파서 — `#태그` / `[[위키]]` 토큰과 자유 텍스트 분리
 *
 * 예)
 *   "#일상"                 → tags ['일상'],            text ''
 *   "[[행동 경제학]] 넛지"   → wikis ['행동 경제학'],   text '넛지'
 *   "#독서 #롱블랙"          → tags ['독서','롱블랙'] (AND)
 *   "[[마케팅"              → wikis ['마케팅'] (닫는 ]] 없이 입력 중이어도 인식)
 *
 * 왜 필요한가:
 *   예전에는 prefix(#, [[)만 떼고 본문 텍스트 검색을 했기 때문에
 *   `[[사랑` 검색 시 위키가 달린 21건이 아니라 '사랑'이 본문에 들어간 79건이 나왔다.
 *   태그/위키 토큰은 memo.tags / memo.wikiLinks에 대한 **정규화 키 일치 필터**로 처리한다.
 */

import { tagKey, wikiKey } from '@/lib/wiki/normalize'

export interface ParsedSearch {
  tags: string[]
  wikis: string[]
  /** 태그/위키 토큰을 뺀 나머지 자유 텍스트 (본문 검색용) */
  text: string
}

export function parseSearchQuery(raw: string | null | undefined): ParsedSearch {
  const tags: string[] = []
  const wikis: string[] = []
  let rest = (raw ?? '').trim()

  // [[위키]] — 닫힘 ]] 또는 문자열 끝까지 (입력 중인 미완성 토큰 허용)
  rest = rest.replace(/\[\[([^[\]]*?)(?:\]\]|$)/g, (_m, label: string) => {
    const l = label.trim()
    if (l) wikis.push(l)
    return ' '
  })

  // #태그 — 문장 시작 또는 공백 뒤의 #만 (C#, url#hash 같은 본문 # 오인 방지)
  rest = rest.replace(/(^|\s)#([^\s#[\]]+)/g, (_m, pre: string, label: string) => {
    tags.push(label)
    return pre
  })

  // 남은 단독 '#', '[[' 같은 빈 prefix 제거
  const text = rest.replace(/(^|\s)#(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim()
  return { tags, wikis, text }
}

export function hasTokenFilters(p: ParsedSearch): boolean {
  return p.tags.length > 0 || p.wikis.length > 0
}

/**
 * 토큰 하나가 메모 라벨 목록과 맞는지.
 * - 등록된 태그/위키와 키가 정확히 일치하면 **정확 일치**만 인정 (`[[마케팅]]` ≠ `마케팅전략`)
 * - 등록된 것 중 정확 일치가 없으면 입력 중으로 보고 **접두 일치** 허용 (`#일` → `#일상`)
 */
function tokenMatches(
  token: string,
  labels: string[] | undefined,
  keyFn: (s: string) => string,
  knownKeys: Set<string>,
): boolean {
  const k = keyFn(token)
  if (!k) return true
  const exact = knownKeys.has(k)
  return (labels ?? []).some((l) => {
    const lk = keyFn(l)
    return exact ? lk === k : lk.startsWith(k)
  })
}

export function memoMatchesTokenFilters(
  memo: { tags?: string[]; wikiLinks?: string[] },
  parsed: ParsedSearch,
  knownTagKeys: Set<string>,
  knownWikiKeys: Set<string>,
): boolean {
  return (
    parsed.tags.every((t) => tokenMatches(t, memo.tags, tagKey, knownTagKeys)) &&
    parsed.wikis.every((w) => tokenMatches(w, memo.wikiLinks, wikiKey, knownWikiKeys))
  )
}
