'use client'

import { useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import { createClient } from '@/lib/supabase/client'
import { clearLocalAccountData } from '@/lib/account/clearLocalData'
import { reportSaveError } from '@/lib/ui/reportSaveError'
import { cn } from '@/lib/utils'

const CONFIRM_TEXT = '계정 삭제'

interface DeleteAccountModalProps {
  onClose: () => void
  /** 삭제 전 내보내기 섹션으로 이동 */
  onGoToExport: () => void
}

/**
 * 계정 삭제 확인 — 서버(`/api/account/delete`)가 R2 → 계정(CASCADE) 순으로 지운다.
 * 진행 중에는 닫을 수 없다. 실패하면 모달을 유지해 같은 버튼으로 재시도한다(서버가 멱등).
 */
export default function DeleteAccountModal({ onClose, onGoToExport }: DeleteAccountModalProps) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [reauth, setReauth] = useState(false)
  const matches = typed.trim() === CONFIRM_TEXT

  async function handleDelete() {
    if (!matches || busy) return
    setBusy(true)
    try {
      const res = await fetch('/api/account/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: CONFIRM_TEXT }),
      })
      const data = (await res.json().catch(() => ({}))) as { code?: string; error?: string }
      if (res.status === 403 && data.code === 'REAUTH_REQUIRED') {
        setReauth(true)
        setBusy(false)
        return
      }
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)

      // 서버 삭제 완료 — 이후 단계는 실패해도 로그인 화면으로 보낸다
      await clearLocalAccountData()
      // 서버 세션은 계정과 함께 지워졌으므로 로컬 세션만 정리
      await createClient().auth.signOut({ scope: 'local' }).catch(() => {})
      // 전체 이동 — React Query 메모리 캐시까지 비운다
      window.location.replace('/login?deleted=1')
    } catch (err) {
      reportSaveError('삭제하지 못했어요. 잠시 후 다시 시도해주세요.')(err)
      setBusy(false)
    }
  }

  async function handleReauth() {
    setBusy(true)
    await createClient().auth.signOut().catch(() => {})
    window.location.replace('/login?reauth=delete')
  }

  return (
    <Modal
      onClose={busy ? () => {} : onClose}
      ariaLabel="계정 삭제"
      panelClassName="w-[460px] max-w-[92vw]"
      closeOnBackdrop={!busy}
      closeOnEscape={!busy}
    >
      <div className="p-5 sm:p-6 space-y-4 max-h-[85vh] overflow-y-auto">
        <div className="flex items-start gap-3">
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 bg-red-100 text-red-600 dark:bg-red-950/40 dark:text-red-400"
            aria-hidden="true"
          >
            <AlertTriangle size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">계정을 삭제할까요?</h2>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">삭제하면 되돌릴 수 없어요.</p>
          </div>
        </div>

        {reauth ? (
          <div className="space-y-4">
            <p role="alert" className="text-sm text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 px-3 py-2.5 rounded-lg">
              보안을 위해 다시 로그인한 뒤 삭제해주세요. 로그인한 지 24시간이 지나면 계정 삭제 전에 한 번 더 로그인해야 해요.
            </p>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} disabled={busy} className={secondaryButtonClass}>
                닫기
              </button>
              <button
                type="button"
                onClick={handleReauth}
                disabled={busy}
                className={cn(secondaryButtonClass, 'text-white bg-violet-600 hover:bg-violet-700 dark:text-white dark:hover:bg-violet-700')}
              >
                로그아웃하고 다시 로그인
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="space-y-3 text-sm">
              <div>
                <h3 className="font-medium text-gray-900 dark:text-gray-100">삭제되는 것</h3>
                <ul className="mt-1 list-disc pl-5 space-y-0.5 text-gray-600 dark:text-gray-400">
                  <li>메모와 버전 기록</li>
                  <li>플랜과 즐겨찾기 템플릿</li>
                  <li>첨부한 이미지와 PDF 원본</li>
                  <li>AI 대화와 분석 기록</li>
                  <li>Google Drive·Calendar 연결</li>
                </ul>
              </div>
              <div>
                <h3 className="font-medium text-gray-900 dark:text-gray-100">삭제되지 않는 것</h3>
                <p className="mt-1 text-gray-600 dark:text-gray-400">
                  Google Drive에 저장된 백업 파일은 삭제되지 않아요. 필요 없으면 Drive에서 직접 지워주세요.
                </p>
              </div>
              <p className="text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800/60 px-3 py-2.5 rounded-lg">
                삭제 전에 내보내기로 데이터를 받아두세요.{' '}
                <button
                  type="button"
                  onClick={onGoToExport}
                  disabled={busy}
                  className="font-medium text-violet-600 hover:text-violet-700 dark:text-violet-400 underline underline-offset-2 disabled:opacity-50"
                >
                  내보내기로 이동
                </button>
              </p>
            </div>

            <div>
              <label htmlFor="delete-account-confirm" className="block text-sm text-gray-700 dark:text-gray-300 mb-1.5">
                확인을 위해 <strong className="font-semibold text-red-600 dark:text-red-400">{CONFIRM_TEXT}</strong>를 입력해주세요
              </label>
              <input
                id="delete-account-confirm"
                // 앱 표준: type="search" + autoComplete off (모바일 autofill 바 차단)
                type="search"
                autoComplete="off"
                data-form-type="other"
                data-1p-ignore
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void handleDelete() }}
                disabled={busy}
                placeholder={CONFIRM_TEXT}
                aria-describedby="delete-account-hint"
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-red-500/40 focus:border-red-500 disabled:opacity-60"
              />
              <p id="delete-account-hint" className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                문구가 일치해야 삭제 버튼이 켜져요.
              </p>
            </div>

            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} disabled={busy} className={secondaryButtonClass}>
                취소
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={!matches || busy}
                aria-busy={busy}
                className={cn(
                  'flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium text-white',
                  'bg-red-600 hover:bg-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500',
                  'transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer',
                )}
              >
                {busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
                {busy ? '삭제하는 중…' : '계정 영구 삭제'}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}

const secondaryButtonClass = cn(
  'px-3.5 py-2 rounded-lg text-sm font-medium',
  'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800',
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500',
  'transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer',
)
