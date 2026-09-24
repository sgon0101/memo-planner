/**
 * 위키·태그 어휘 정규화 — 단일 출처
 *
 * Weave에서 `[[키워드]]`는 메모→메모 링크가 아니라 **키워드 허브 노드**(`wiki:키워드`)다.
 * 그래서 `[[행동경제학]]`과 `[[행동 경제학]]`은 서로 다른 허브가 되어 연결이 끊긴다.
 * (`#AI` / `#ai`도 마찬가지)
 *
 * 정규화는 **읽는 쪽**(그래프·자동완성·필터·검색)과 **AI가 새로 쓰는 쪽**에서만 한다.
 * 사용자가 쓴 본문 텍스트와 DB에 저장된 원본 표기는 절대 자동으로 고치지 않는다
 * (`wiki_links`/`tags`는 저장 시 본문에서 재추출되므로 본문을 건드리면 되돌릴 수 없다).
 *
 * ⚠️ 포함 관계는 중복이 아니다 — `마케팅` ↔ `마케팅전략`, `성장` ↔ `성장형사고방식`은
 * 상하위 개념이므로 절대 합치지 않는다. **키가 완전히 같을 때만** 병합한다.
 */

/** 키 계산에서 제거할 구분 문자: 공백류 · 밑줄 · 하이픈 · 가운뎃점(·‧・) */
const SEPARATORS = /[\s_\-·‧・]/g

/** 정규화 키: NFC → 소문자 → 구분 문자 제거 */
export function wikiKey(label: string): string {
  return label.normalize('NFC').toLowerCase().replace(SEPARATORS, '')
}

/** 태그용 키: NFC → 소문자 (태그 정규식상 공백이 없어 구분 문자 제거는 불필요) */
export function tagKey(label: string): string {
  return label.normalize('NFC').toLowerCase()
}

export type KeyFn = (label: string) => string

/**
 * 라벨 목록(+사용 횟수) → key별 대표 표기 Map.
 *
 * 대표 선정 순서 (결정적 — 같은 입력이면 입력 순서가 달라도 항상 같은 결과):
 *  ① 사용 횟수가 많은 것
 *  ② 동률이면 공백이 없는 표기
 *  ③ 그래도 동률이면 localeCompare('ko')로 앞선 것
 */
export function buildCanonicalMap(
  entries: Array<{ label: string; count: number }>,
  keyFn: KeyFn = wikiKey,
): Map<string, string> {
  // key → 라벨별 누적 횟수 (같은 라벨이 여러 번 들어와도 합산)
  const byKey = new Map<string, Map<string, number>>()

  for (const { label, count } of entries) {
    const trimmed = label.trim()
    if (!trimmed) continue
    const key = keyFn(trimmed)
    if (!key) continue
    let labels = byKey.get(key)
    if (!labels) {
      labels = new Map<string, number>()
      byKey.set(key, labels)
    }
    labels.set(trimmed, (labels.get(trimmed) ?? 0) + count)
  }

  const canonical = new Map<string, string>()
  for (const [key, labels] of byKey) {
    let best: string | null = null
    let bestCount = -1
    for (const [label, count] of labels) {
      if (best === null || isBetterRepresentative(label, count, best, bestCount)) {
        best = label
        bestCount = count
      }
    }
    if (best !== null) canonical.set(key, best)
  }
  return canonical
}

/** 대표 표기 우선순위 비교 — a가 현재 best보다 나은가 */
function isBetterRepresentative(a: string, aCount: number, b: string, bCount: number): boolean {
  if (aCount !== bCount) return aCount > bCount
  const aSpaced = /\s/.test(a)
  const bSpaced = /\s/.test(b)
  if (aSpaced !== bSpaced) return !aSpaced
  return a.localeCompare(b, 'ko') < 0
}

/**
 * 라벨을 기존 대표 표기로 치환. 대응하는 대표가 없으면 원본을 trim해서 돌려준다.
 * (AI가 새로 제안한 표기를 기존 어휘에 맞추는 데 사용)
 */
export function resolveToCanonical(
  label: string,
  canonical: Map<string, string>,
  keyFn: KeyFn = wikiKey,
): string {
  const trimmed = label.trim()
  if (!trimmed) return trimmed
  return canonical.get(keyFn(trimmed)) ?? trimmed
}
