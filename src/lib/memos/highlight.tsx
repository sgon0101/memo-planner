'use client'

/**
 * 검색 결과 하이라이트 유틸
 *
 * - 검색어를 #/[[ prefix 제거 후 공백 토큰화
 * - 문자열 내 매칭 부분을 <mark>로 래핑 (대소문자 무시, 띄어쓰기 정규화)
 * - 본문은 첫 매칭 주변 snippet으로 잘라서 표시
 */

import React from 'react'
import { parseSearchQuery } from './searchQuery'

/** 검색어 → 하이라이트 토큰 (자유 텍스트 단어 + #태그 / [[위키]] 라벨) */
export function getHighlightTokens(query: string | undefined | null): string[] {
  if (!query) return []
  const { tags, wikis, text } = parseSearchQuery(query)
  return [...text.split(/\s+/).filter(Boolean), ...tags, ...wikis]
}

/** 본문에서 첫 매칭 주변 ±context 글자 추출 (앞 ellipsis 처리) */
export function getSnippet(
  text: string | null | undefined,
  query: string | undefined | null,
  context = 50,
): string {
  if (!text) return ''
  const tokens = getHighlightTokens(query)
  if (tokens.length === 0) return text

  const lower = text.toLowerCase()
  let firstIdx = -1
  for (const t of tokens) {
    const idx = lower.indexOf(t.toLowerCase())
    if (idx >= 0 && (firstIdx === -1 || idx < firstIdx)) firstIdx = idx
  }
  // 매칭 없으면 앞부분 그대로
  if (firstIdx < 0) return text

  const start = Math.max(0, firstIdx - context)
  const end = Math.min(text.length, firstIdx + context * 2)
  let snippet = text.slice(start, end)
  if (start > 0) snippet = '…' + snippet
  if (end < text.length) snippet = snippet + '…'
  return snippet
}

/** 문자열을 토큰 매칭 위치에서 분리해 <mark>으로 래핑한 React 노드 반환 */
export function highlight(
  text: string | null | undefined,
  query: string | undefined | null,
): React.ReactNode {
  if (!text) return ''
  const tokens = getHighlightTokens(query)
  if (tokens.length === 0) return text

  const escaped = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const regex = new RegExp(`(${escaped.join('|')})`, 'gi')
  const parts = text.split(regex)

  return parts.map((part, i) => {
    if (!part) return null
    // 짝수 인덱스 = 매칭 외, 홀수 인덱스 = 매칭 (regex split의 capture group)
    if (i % 2 === 1) {
      return (
        <mark
          key={i}
          className="bg-amber-200 dark:bg-amber-500/30 text-gray-900 dark:text-amber-100 rounded-sm px-0.5 font-medium"
        >
          {part}
        </mark>
      )
    }
    return <React.Fragment key={i}>{part}</React.Fragment>
  })
}

/** 태그/위키 등 검색 매칭 여부 확인 */
export function matchesQuery(
  value: string,
  query: string | undefined | null,
): boolean {
  const tokens = getHighlightTokens(query)
  if (tokens.length === 0) return false
  const lower = value.toLowerCase()
  return tokens.some((t) => lower.includes(t.toLowerCase()))
}
