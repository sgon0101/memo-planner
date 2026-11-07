/**
 * 즐겨찾기 삭제 + 되돌리기 (2026-10-11 UX 2차)
 *
 * 화면에서는 즉시 숨기고, 되돌리기 시간이 지나면 실제로 삭제한다.
 * 되돌리기를 누르면 서버는 건드리지 않은 채 다시 보여주기만 하면 된다.
 * 서버 삭제가 실패하면 다시 보여주고 저장 실패 토스트를 띄운다.
 */

import { createClient } from '@/lib/supabase/client'
import { toast } from '@/components/ui/Toast'
import { reportSaveError } from '@/lib/ui/reportSaveError'
import { templateIdsWithSameKey } from '@/lib/planner/templates'
import type { PlanTemplate } from '@/types'

const UNDO_MS = 6500

interface UndoOpts {
  /** 화면에서 숨기기 (낙관적) */
  hide: () => void
  /** 다시 보여주기 (되돌리기 또는 실패 시) */
  restore: () => void
  /** 서버 삭제 확정 후 (예: refetch) */
  onCommitted?: () => void
}

export function deleteTemplateWithUndo(t: PlanTemplate, { hide, restore, onCommitted }: UndoOpts) {
  hide()
  let undone = false

  const timer = setTimeout(async () => {
    if (undone) return
    // 같은 제목 중복(과거 데이터)까지 함께 지운다 — 하나만 지우면 숨어 있던 중복이 다시 보인다
    const supabase = createClient()
    let ids = [t.id]
    try { ids = [...new Set([t.id, ...(await templateIdsWithSameKey(supabase, t.title))])] } catch { /* 조회 실패 시 보이는 행만 */ }
    const { error } = await supabase.from('plan_templates').delete().in('id', ids)
    if (error) {
      restore()
      reportSaveError('즐겨찾기를 삭제하지 못했어요.')(error)
      return
    }
    onCommitted?.()
  }, UNDO_MS)

  toast.info(`'${t.title}' 즐겨찾기를 삭제했어요.`, {
    duration: UNDO_MS,
    action: {
      label: '되돌리기',
      onClick: () => {
        undone = true
        clearTimeout(timer)
        restore()
      },
    },
  })
}
