'use client'

/**
 * 전역 Autofill 차단기
 *
 * 모든 <input> / <textarea>에 password 매니저·결제수단·위치 등 OS/브라우저
 * 자동완성 제안이 뜨지 않도록 속성을 강제 부여.
 *
 * 동작:
 *  1. 초기 마운트 시 document 안 모든 input/textarea 순회 → 속성 적용
 *  2. MutationObserver로 DOM에 새로 추가되는 input/textarea도 자동 적용
 *  3. type=password 는 제외 (비밀번호 매니저 동작 보존)
 *
 * 적용 속성:
 *  - autoComplete="off" / autoCorrect="off" / spellCheck=false
 *  - data-1p-ignore, data-lpignore, data-form-type=other
 *  - name 속성에 'memo'·'plan' 같은 무관한 값 (browser autofill 휴리스틱 회피)
 */

import { useEffect } from 'react'

export default function AutofillBlocker() {
  useEffect(() => {
    function harden(el: HTMLInputElement | HTMLTextAreaElement) {
      // type=password는 건들지 않음 (1password/Chrome 비번 매니저 보존)
      if (el instanceof HTMLInputElement && el.type === 'password') return
      // type=file/checkbox/radio/range/color는 autofill 무관
      if (el instanceof HTMLInputElement) {
        const skipTypes = ['file', 'checkbox', 'radio', 'range', 'color', 'submit', 'button', 'reset', 'hidden']
        if (skipTypes.includes(el.type)) return
      }
      // 이미 처리됐으면 skip
      if (el.dataset.autofillBlocked === '1') return
      el.dataset.autofillBlocked = '1'

      // React가 setAttribute로 다시 덮어쓸 수 있으니 양쪽으로 set
      el.setAttribute('autocomplete', 'off')
      el.setAttribute('autocorrect', 'off')
      el.setAttribute('spellcheck', 'false')
      el.setAttribute('data-1p-ignore', 'true')
      el.setAttribute('data-lpignore', 'true')
      el.setAttribute('data-form-type', 'other')
      // name이 'username/email/address' 등이면 브라우저가 autofill 제안 → 임의 이름으로 변환
      const susNames = /^(?:username|user|email|address|street|city|zip|postal|tel|phone|cc-|credit|card)/i
      if (!el.name || susNames.test(el.name)) {
        // input마다 고유 — collision 방지
        el.name = `_${(el.tagName === 'TEXTAREA' ? 'ta' : 'in')}_${Math.random().toString(36).slice(2, 8)}`
      }
    }

    // 초기 적용
    document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea').forEach(harden)

    // 동적 추가 감지
    const mo = new MutationObserver((mutations) => {
      for (const m of mutations) {
        m.addedNodes.forEach((n) => {
          if (!(n instanceof HTMLElement)) return
          if (n.matches?.('input, textarea')) {
            harden(n as HTMLInputElement | HTMLTextAreaElement)
          }
          n.querySelectorAll?.<HTMLInputElement | HTMLTextAreaElement>('input, textarea').forEach(harden)
        })
      }
    })
    mo.observe(document.body, { childList: true, subtree: true })

    return () => mo.disconnect()
  }, [])

  return null
}
