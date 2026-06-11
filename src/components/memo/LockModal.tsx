'use client'

import { useState } from 'react'
import { X, Lock, Unlock } from 'lucide-react'
import Modal from '@/components/ui/Modal'

interface LockModalProps {
  mode: 'lock' | 'unlock'
  onConfirm: (password: string) => Promise<void>
  onClose: () => void
}

export default function LockModal({ mode, onConfirm, onClose }: LockModalProps) {
  const [pw, setPw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (mode === 'lock' && pw !== confirm) {
      setError('비밀번호가 일치하지 않습니다.')
      return
    }
    if (pw.length < 4) {
      setError('비밀번호는 4자 이상이어야 합니다.')
      return
    }
    setLoading(true)
    try {
      await onConfirm(pw)
      onClose()
    } catch {
      setError(mode === 'unlock' ? '비밀번호가 올바르지 않습니다.' : '처리 중 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      onClose={onClose}
      ariaLabel={mode === 'lock' ? '메모 잠금' : '메모 잠금 해제'}
      panelClassName="p-6 w-80"
    >
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            {mode === 'lock'
              ? <Lock size={16} className="text-violet-600" />
              : <Unlock size={16} className="text-violet-600" />
            }
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
              {mode === 'lock' ? '메모 잠금' : '메모 잠금 해제'}
            </h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
              {mode === 'lock' ? '새 비밀번호' : '비밀번호'}
            </label>
            <input
              type="password"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              placeholder="4자 이상"
              autoFocus
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
            />
          </div>

          {mode === 'lock' && (
            <div>
              <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                비밀번호 확인
              </label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="비밀번호 재입력"
                className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
              />
            </div>
          )}

          {error && (
            <p className="text-xs text-red-500 bg-red-50 dark:bg-red-950/30 px-3 py-2 rounded-lg">
              {error}
            </p>
          )}

          {mode === 'lock' && (
            <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 rounded-lg">
              ⚠ 비밀번호를 잊으면 내용을 복구할 수 없습니다.
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
          >
            {loading ? '처리 중...' : mode === 'lock' ? '잠금 설정' : '잠금 해제'}
          </button>
        </form>
    </Modal>
  )
}
