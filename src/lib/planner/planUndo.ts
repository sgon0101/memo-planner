/**
 * 플랜 조작 실행 취소 (2026-11 플래너 개선 1차).
 *
 * 마지막 조작 1개만 기억한다. 토스트의 '되돌리기' 버튼 또는 ⌘/Ctrl+Z로 실행.
 * 토스트가 사라진 뒤에도 UNDO_WINDOW_MS 동안은 단축키로 되돌릴 수 있다.
 * 되돌리기 자체가 실패하면 저장 실패 토스트로 알린다.
 */

import { toast } from '@/components/ui/Toast'
import { reportSaveError } from '@/lib/ui/reportSaveError'

export const TOAST_MS = 6500
const UNDO_WINDOW_MS = 30_000

interface UndoEntry {
  undo: () => Promise<unknown>
  at: number
  used: boolean
  /** 이 시간이 지나면 단축키로도 되돌릴 수 없다 (예: 지연 삭제가 서버에 확정된 뒤) */
  windowMs: number
}

let last: UndoEntry | null = null

export function pushPlanUndo(
  message: string,
  undo: () => Promise<unknown>,
  opts: { windowMs?: number; silent?: boolean } = {},
): void {
  const entry: UndoEntry = { undo, at: Date.now(), used: false, windowMs: opts.windowMs ?? UNDO_WINDOW_MS }
  last = entry
  // silent: 결과가 화면에 바로 보이는 조작은 토스트 없이 ⌘/Ctrl+Z로만 되돌린다 (2026-11-08 토스트 정리)
  if (opts.silent) return
  toast.success(message, {
    duration: TOAST_MS,
    action: { label: '되돌리기', onClick: () => { void runUndo(entry) } },
  })
}

async function runUndo(entry: UndoEntry): Promise<boolean> {
  if (entry.used || Date.now() - entry.at > entry.windowMs) return false
  entry.used = true // 두 번 눌러도 한 번만
  if (last === entry) last = null
  try {
    await entry.undo()
    return true
  } catch (err) {
    reportSaveError('되돌리지 못했어요.')(err)
    return false
  }
}

/** ⌘/Ctrl+Z — 되돌릴 게 있으면 실행하고 true */
export async function undoLastPlanAction(): Promise<boolean> {
  const entry = last
  if (!entry || entry.used || Date.now() - entry.at > entry.windowMs) return false
  // 되돌린 결과가 화면에 바로 보이므로 '되돌렸어요' 토스트는 띄우지 않는다
  return runUndo(entry)
}

/** 테스트·로그아웃용 */
export function clearPlanUndo(): void { last = null }
