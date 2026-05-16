import { Extension } from '@tiptap/core'

/**
 * Enter 키 동작 재정의
 *   1회: 같은 문단 내 줄바꿈 (hardBreak = <br>)
 *   2회: 이전 hardBreak 제거 후 새 문단 분리 (paragraph split)
 *
 * 일반 paragraph 이외의 노드(코드블록·목록·제목 등)에서는 기본 동작 유지.
 */
export const CustomEnterExtension = Extension.create({
  name: 'customEnter',
  priority: 150,

  addKeyboardShortcuts() {
    return {
      Enter: ({ editor }) => {
        const { state } = editor
        const { selection } = state
        const { $from, empty } = selection

        // 선택 영역이 있거나 paragraph 외 노드면 기본 핸들러에 위임
        if (!empty || $from.parent.type !== state.schema.nodes.paragraph) return false

        // 빈 paragraph에서 Enter → 기본 핸들러(새 문단 생성)에 위임
        if ($from.parent.content.size === 0) return false

        const nodeBefore = $from.nodeBefore

        // 바로 앞이 hardBreak → 두 번째 Enter: hardBreak 제거 후 문단 분리
        if (nodeBefore?.type === state.schema.nodes.hardBreak) {
          return editor.commands.command(({ tr, dispatch, state }) => {
            const { $from } = state.selection
            const nb = $from.nodeBefore
            if (!nb || nb.type.name !== 'hardBreak') return false
            if (dispatch) {
              const pos = $from.pos
              const start = pos - nb.nodeSize
              tr.delete(start, pos)
              tr.split(tr.mapping.map(pos))
              dispatch(tr)
            }
            return true
          })
        }

        // 첫 번째 Enter: 줄바꿈 (같은 문단 내 <br>)
        return editor.commands.setHardBreak()
      },
    }
  },
})
