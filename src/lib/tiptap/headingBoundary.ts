/**
 * 제목 ↔ 문단 경계 Delete/Backspace 판정 (순수 로직)
 *
 * HeadingBoundaryGuard extension이 이 함수들의 결과대로만 동작한다.
 * 에디터/뷰에 의존하지 않으므로 prosemirror state만으로 단위 테스트가 가능하다.
 *
 * 반환값
 *  - null        : 가드 대상 아님 → ProseMirror 기본 동작에 위임
 *  - { tr: null }: 기본 동작만 막는다 (문서 변경 없음)
 *  - { tr }      : 이 트랜잭션을 dispatch 한다
 */

import { TextSelection } from '@tiptap/pm/state'
import type { EditorState, Transaction } from '@tiptap/pm/state'

export type BoundaryAction = { tr: Transaction | null } | null

/**
 * 제목 맨 끝에서 Delete.
 * 아래가 빈 줄이면 그 줄만 삭제하고, 내용이 있으면 병합을 막기만 한다.
 */
export function planHeadingDelete(state: EditorState): BoundaryAction {
  const { selection } = state
  if (!selection.empty) return null

  const { $from } = selection
  if ($from.parent.type.name !== 'heading') return null
  // 제목의 맨 끝이 아니면 일반 삭제
  if ($from.parentOffset !== $from.parent.content.size) return null

  const after = $from.after()
  if (after >= state.doc.content.size) return null

  const next = state.doc.resolve(after).nodeAfter
  // 다음 형제가 없거나(문서 끝) 텍스트 블록이 아니거나(이미지·표 등)
  // 제목끼리면 기본 동작 유지
  if (!next || !next.isTextblock || next.type.name === 'heading') return null

  // 아래가 빈 줄이면 그 빈 줄만 삭제 (커서는 제목 끝 그대로)
  if (next.content.size === 0) {
    return { tr: state.tr.delete(after, after + next.nodeSize) }
  }

  // 내용이 있는 문단은 제목으로 합치지 않는다
  return { tr: null }
}

/**
 * 제목 바로 아래 블록의 맨 앞에서 Backspace.
 * 빈 줄이면 지우고 커서를 제목 끝으로, 내용이 있으면 커서만 제목 끝으로 옮긴다.
 */
export function planHeadingBackspace(state: EditorState): BoundaryAction {
  const { selection } = state
  if (!selection.empty) return null

  const { $from } = selection
  if ($from.parentOffset !== 0) return null
  // 제목 안에서의 Backspace는 기본 동작(입력 규칙 취소 등)에 위임
  if ($from.parent.type.name === 'heading') return null
  if (!$from.parent.isTextblock) return null
  // 최상위 블록만 대상 — 목록/인용 안쪽은 기본 동작(내어쓰기 등)을 지킨다
  if ($from.depth !== 1) return null

  const before = $from.before()
  const prev = state.doc.resolve(before).nodeBefore
  if (!prev || prev.type.name !== 'heading') return null

  // before - 1 = 제목 노드 안쪽 끝 위치
  if ($from.parent.content.size === 0) {
    // 빈 줄이면 삭제하고 커서를 제목 끝으로
    const tr = state.tr.delete(before, $from.after())
    tr.setSelection(TextSelection.create(tr.doc, before - 1))
    return { tr }
  }

  // 내용이 있으면 병합하지 않고 커서만 제목 끝으로 이동
  return { tr: state.tr.setSelection(TextSelection.create(state.doc, before - 1)) }
}
