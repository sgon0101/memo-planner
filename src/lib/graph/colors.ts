// 그래프 뷰 색상 단일 출처
// GraphView/GraphSettings에 중복 정의돼 있던 색상·nodeColor 로직을 통합.
// 색상 변경 시 이 파일만 수정하면 캔버스/범례가 함께 반영된다.

import type { GraphNode } from '@/store/graphStore'

export const GRAPH_COLORS = {
  /** [[위키]] 허브 노드 */
  wiki: '#1D9E75',
  wikiBorder: '#0F6E56',
  /** #태그 허브 노드 */
  tag: '#378ADD',
  tagBorder: '#185FA5',
  /** ★ 중요 메모 외곽선 */
  starred: '#EF9F27',
  /** 메모 노드 — 링크 수에 따른 단계 */
  memoIsolated: '#B4B2A9', // 0 links
  memoFew: '#CECBF6',      // 1-2
  memoSome: '#AFA9EC',     // 3-4
  memoMany: '#7F77DD',     // 5-6
  memoHub: '#534AB7',      // 7+
} as const

/** 노드 채움 색상 — 링크 수 기반 단계 */
export function nodeColor(n: GraphNode): string {
  if (n.type === 'wiki') return GRAPH_COLORS.wiki
  if (n.type === 'tag')  return GRAPH_COLORS.tag
  const c = n.linkCount
  if (c === 0)  return GRAPH_COLORS.memoIsolated
  if (c <= 2) return GRAPH_COLORS.memoFew
  if (c <= 4) return GRAPH_COLORS.memoSome
  if (c <= 6) return GRAPH_COLORS.memoMany
  return GRAPH_COLORS.memoHub
}
