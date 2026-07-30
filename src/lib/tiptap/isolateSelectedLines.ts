/**
 * 제목(H1~H3) 적용 범위 오류 수정용 헬퍼
 *
 * 문제: CustomEnterExtension이 Enter 1회를 hardBreak(같은 문단 내 줄바꿈)로
 * 처리하므로, 화면상 여러 "줄"이 실제로는 하나의 paragraph 노드다.
 * Tiptap의 toggleHeading은 블록 단위로 동작해, 한 줄만 드래그해도
 * 문단 전체(주변 줄 포함)가 제목으로 바뀌는 버그가 발생했다.
 *
 * 해결: 제목 적용 전에 이 함수를 호출해 선택 영역이 걸친 "줄"들을
 * 독립된 paragraph로 분리한다.
 *  - 선택(또는 커서)이 있는 줄의 앞/뒤 hardBreak를 제거하고 그 위치에서 문단 split
 *  - 분리 후 선택 영역을 원래 텍스트 범위로 복원 → 이어지는 toggleHeading이
 *    분리된 문단(선택한 줄)에만 적용됨
 *
 * 분리가 불필요한 경우(단일 줄 문단, 여러 문단에 걸친 선택, 전체 줄 선택)는
 * 아무것도 하지 않는다 (no-op).
 */

import type { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'

export function isolateSelectedLines(editor: Editor): void {
  const { state } = editor
  const { $from, $to, from, to } = state.selection

  // 여러 블록에 걸친 선택 — 블록 단위 적용이 기대 동작이므로 그대로 둠
  if (!$from.sameParent($to)) return

  const parent = $from.parent
  if (parent.type.name !== 'paragraph') return

  // hardBreak가 없으면 이미 한 줄짜리 문단 — 분리 불필요
  let hasBreak = false
  parent.forEach((child) => {
    if (child.type.name === 'hardBreak') hasBreak = true
  })
  if (!hasBreak) return

  const parentStart = $from.start()

  // 선택 앞의 마지막 hardBreak / 선택 뒤의 첫 hardBreak 위치 탐색
  let brBefore: number | null = null
  let brAfter: number | null = null
  parent.forEach((child, offset) => {
    if (child.type.name !== 'hardBreak') return
    const pos = parentStart + offset
    if (pos + child.nodeSize <= from) brBefore = pos // 반복되며 마지막 것으로 갱신
    if (pos >= to && brAfter === null) brAfter = pos
  })

  // 선택이 문단의 모든 줄을 이미 포함 — 분리 불필요
  if (brBefore === null && brAfter === null) return

  const tr = state.tr

  // 뒤쪽 경계 먼저 처리 (앞쪽 위치에 영향 없음): hardBreak 제거 후 그 자리에서 split
  if (brAfter !== null) {
    tr.delete(brAfter, brAfter + 1)
    tr.split(brAfter)
  }
  // 앞쪽 경계: hardBreak 제거 후 split → 선택한 줄이 독립 문단이 됨
  if (brBefore !== null) {
    tr.delete(brBefore, brBefore + 1)
    tr.split(brBefore)
  }

  // 선택 영역을 분리된 문단 안의 원래 텍스트 범위로 복원.
  // assoc 편향이 중요: to가 split 지점(줄 끝)에 있을 때 기본 매핑(assoc=1)은
  // 다음 문단의 시작으로 넘어가 선택이 두 블록에 걸치게 되고, 이어지는
  // toggleHeading이 다음 줄까지 제목으로 바꾼다 (라이브 검증에서 발견).
  // from은 앞으로(1), to는 뒤로(-1) 붙여 선택이 분리된 문단 안에만 머물게 한다.
  const mFrom = tr.mapping.map(from, 1)
  const mTo = tr.mapping.map(to, -1)
  tr.setSelection(TextSelection.create(tr.doc, Math.min(mFrom, mTo), Math.max(mFrom, mTo)))

  editor.view.dispatch(tr)
}
