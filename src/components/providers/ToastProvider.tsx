/**
 * 토스트 배선 — `toast.*()` 호출을 화면에 연결한다.
 *
 * 기존엔 `ui/Toast.tsx`의 `registerToastCallback`을 아무도 호출하지 않고
 * `ToastContainer`도 렌더되지 않아, 앱 전체의 toast 호출이 조용히 무시됐다.
 * 이 컴포넌트가 콜백을 등록하고 컨테이너를 렌더한다.
 *
 * 개별 토스트의 자동 사라짐/닫기는 Toast 컴포넌트가 스스로 처리하므로
 * 여기서는 목록 상태만 관리한다.
 */

'use client'

import { useCallback, useEffect, useState } from 'react'
import { ToastContainer, registerToastCallback, type ToastItem } from '@/components/ui/Toast'

/** 동시에 쌓아둘 최대 개수 — 초과분은 오래된 것부터 밀어낸다 */
const MAX_TOASTS = 4

export function ToastProvider() {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  useEffect(() => {
    registerToastCallback((item) => {
      setToasts((prev) => [...prev, item].slice(-MAX_TOASTS))
    })
  }, [])

  const handleClose = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  return <ToastContainer toasts={toasts} onClose={handleClose} />
}
