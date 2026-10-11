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
    const { error } = await createClient().from('plan_templates').delete().eq('id', t.id)
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
