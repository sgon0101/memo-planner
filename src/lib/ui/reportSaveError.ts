/**
 * 저장 실패를 사용자에게 알린다 (2026-10-11 UX 1차 묶음)
 *
 * 기존엔 `.catch(console.error)`로 실패가 조용히 묻혀서, 낙관적 업데이트가 롤백되거나
 * 화면만 바뀐 채 서버엔 반영되지 않아도 사용자는 알 수 없었다.
 *
 * 사용:  doSomething(id).catch(reportSaveError('플랜을 삭제하지 못했어요', () => doSomething(id)))
 * - message: 완결된 한국어 문장 (조사 처리를 호출부에서 하도록)
 * - retry:   멱등(같은 인자로 다시 불러도 안전)한 작업에만 넘길 것
 */

import * as Sentry from '@sentry/nextjs'
import { toast } from '@/components/ui/Toast'

const RETRY_TOAST_MS = 10_000

export function reportSaveError(message: string, retry?: () => Promise<unknown>) {
  return (err: unknown): void => {
    console.error(`[weave:save] ${message}`, err)
    Sentry.captureException(err, { tags: { area: 'save' }, extra: { message } })

    const offline = typeof navigator !== 'undefined' && !navigator.onLine
    const text = offline ? `${message} 인터넷 연결을 확인해주세요.` : message

    toast.error(
      text,
      retry
        ? {
            // 재시도도 실패하면 같은 retry를 다시 넘겨 버튼이 계속 남게 한다
            action: { label: '다시 시도', onClick: () => { void retry().catch(reportSaveError(message, retry)) } },
            // 오류 + 행동 버튼은 읽고 누를 시간이 더 필요 (기본 6.5초 → 10초)
            duration: RETRY_TOAST_MS,
          }
        : undefined,
    )
  }
}
