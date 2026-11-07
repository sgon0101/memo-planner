'use client'

/**
 * 플래너 첫 사용 안내 진행도 (2026-11).
 *
 * Arch처럼 연습용 플랜을 미리 넣으면 리텐션 트리거(zz_analytics_plans_insert)가 그걸
 * '첫 플랜'(활성화 마일스톤)으로 기록해 베타 지표가 오염된다. 그래서 가짜 데이터 없이,
 * 사용자가 실제로 해낸 행동으로 단계를 체크한다. 기기별 진행도(localStorage).
 */

import { buildUserCacheKey } from '@/lib/auth/currentUser'

export type GuideStep = 'capture' | 'schedule' | 'complete'
const EVENT = 'weave:planner-guide'

function key(name: string): string | null {
  return buildUserCacheKey(`planner-guide-${name}`)
}

export function readGuide(): { dismissed: boolean; done: Record<GuideStep, boolean> } {
  const get = (n: string) => {
    try { const k = key(n); return !!k && localStorage.getItem(k) === '1' } catch { return false }
  }
  return {
    dismissed: get('dismissed'),
    done: { capture: get('capture'), schedule: get('schedule'), complete: get('complete') },
  }
}

export function markGuideStep(step: GuideStep): void {
  try {
    const k = key(step)
    if (!k || localStorage.getItem(k) === '1') return
    localStorage.setItem(k, '1')
    window.dispatchEvent(new Event(EVENT))
  } catch { /* 무시 */ }
}

export function dismissGuide(): void {
  try { const k = key('dismissed'); if (k) localStorage.setItem(k, '1') } catch { /* 무시 */ }
  window.dispatchEvent(new Event(EVENT))
}

export function subscribeGuide(fn: () => void): () => void {
  window.addEventListener(EVENT, fn)
  return () => window.removeEventListener(EVENT, fn)
}
