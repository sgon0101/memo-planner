/**
 * 제목 ↔ 문단 경계 병합 방지
 *
 * 문제: ProseMirror 기본 joinForward/joinBackward는 제목 끝에서 Delete,
 * 또는 제목 바로 아래 문단 맨 앞에서 Backspace를 누르면 아래 문단을 제목 블록에
 * 합쳐버린다. 그 결과 본문 한 문단이 통째로 제목 서식으로 바뀐다.
 *
 * 해결: 두 경계에서만 기본 동작을 가로채고
 *  - 아래(또는 현재)가 빈 줄이면 그 빈 줄만 삭제
 *  - 내용이 있으면 병합하지 않고 커서만 제목 끝으로 이동
 *
 * 판정은 전부 headingBoundary.ts의 순수 함수가 한다 (단위 테스트 대상).
 * 목록/체크리스트/인용 안쪽과 문단끼리·제목끼리 병합은 기본 동작 그대로다.
 */

import { Extension } from '@tiptap/core'
import { planHeadingBackspace, planHeadingDelete } from './headingBoundary'

export const HeadingBoundaryGuard = Extension.create({
  name: 'headingBoundaryGuard',
  // 기본 Backspace/Delete 핸들러보다 먼저 판정해야 하므로 높게
  priority: 1000,

  addKeyboardShortcuts() {
    return {
      // 제목 맨 끝에서 Delete — 아래 문단을 끌어올려 제목으로 만들지 않는다
      Delete: () => {
        const { state, view } = this.editor
        const action = planHeadingDelete(state)
        if (!action) return false
        if (action.tr) view.dispatch(action.tr)
        return true
      },

      // 제목 바로 아래 문단 맨 앞에서 Backspace
      Backspace: () => {
        const { state, view } = this.editor
        const action = planHeadingBackspace(state)
        if (!action) return false
        if (action.tr) view.dispatch(action.tr)
        return true
      },
    }
  },
})
