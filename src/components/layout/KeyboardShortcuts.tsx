'use client'

/**
 * 글로벌 키보드 단축키 + 도움말 모달
 *
 * 동작:
 *  - input / textarea / contenteditable 안에서는 모든 단축키 비활성 (Esc만 예외)
 *  - Ctrl/Cmd/Alt 조합은 무시 (기본 단축키 충돌 방지)
 *  - 단, Ctrl/Cmd+Shift+K(빠른 캡처)는 입력 중에도 동작
 *  - `g` prefix는 700ms sequence (Vim 스타일: `g h` → 홈)
 *  - `?` (Shift+/) — 단축키 안내 모달
 *  - `n` — 새 메모
 *  - `/` — 검색창 포커스 (현재 페이지의 [data-shortcut="search"] 또는 첫 검색 input)
 *  - 메모 페이지 전용: `j` 다음, `k` 이전, `s` 별표
 */

import { useEffect, useState, useRef } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { X } from 'lucide-react'
import { useUIStore } from '@/store/uiStore'

type Shortcut = {
  keys: string[]      // 표시용
  label: string
  scope?: '전체' | '메모' | '플래너'
}

const SHORTCUTS: Shortcut[] = [
  { keys: ['?'], label: '단축키 안내 열기', scope: '전체' },
  { keys: ['Ctrl', 'Shift', 'K'], label: '빠른 캡처 (메모/플랜)', scope: '전체' },
  { keys: ['N'], label: '새 메모 작성', scope: '전체' },
  { keys: ['/'], label: '검색창 포커스', scope: '전체' },
  { keys: ['G', 'H'], label: '홈으로', scope: '전체' },
  { keys: ['G', 'M'], label: '메모로', scope: '전체' },
  { keys: ['G', 'P'], label: '플래너로', scope: '전체' },
  { keys: ['G', 'G'], label: '그래프로', scope: '전체' },
  { keys: ['G', 'I'], label: 'AI 인사이트로', scope: '전체' },
  { keys: ['G', 'S'], label: '설정으로', scope: '전체' },
  { keys: ['Ctrl', 'S'], label: '에디터 저장', scope: '메모' },
  { keys: ['Esc'], label: '모달/패널 닫기', scope: '전체' },
]

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false
  const tag = t.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (t.isContentEditable) return true
  // Tiptap 등 ProseMirror
  if (t.closest('.ProseMirror')) return true
  return false
}

export default function KeyboardShortcuts() {
  const router = useRouter()
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const openQuickCapture = useUIStore((s) => s.openQuickCapture)
  const gPrefix = useRef<number | null>(null)  // performance.now() 값 또는 null
  const pathRef = useRef(pathname)

  useEffect(() => { pathRef.current = pathname }, [pathname])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Ctrl/Cmd+Shift+K — 빠른 캡처 (입력 중에도 동작, 가장 먼저 처리)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'K' || e.key === 'k')) {
        e.preventDefault()
        openQuickCapture()
        return
      }

      // Esc — 모달 우선
      if (e.key === 'Escape') {
        if (open) { setOpen(false); return }
      }

      // 입력 중이면 단축키 무시
      if (isTypingTarget(e.target)) return
      // 조합키 무시
      if (e.ctrlKey || e.metaKey || e.altKey) return

      const k = e.key

      // `?` (Shift+/) — 도움말
      if (k === '?') {
        e.preventDefault()
        setOpen((v) => !v)
        return
      }

      // 모달 열려있을 때는 다른 단축키 비활성
      if (open) return

      // `g` prefix
      if (gPrefix.current !== null && performance.now() - gPrefix.current < 700) {
        gPrefix.current = null
        const map: Record<string, string> = {
          h: '/home',
          m: '/memo',
          p: '/planner',
          g: '/graph',
          i: '/insights',
          s: '/settings',
        }
        const target = map[k.toLowerCase()]
        if (target) {
          e.preventDefault()
          router.push(target)
        }
        return
      }
      if (k === 'g' || k === 'G') {
        gPrefix.current = performance.now()
        return
      }

      // `n` — 새 메모
      if (k === 'n' || k === 'N') {
        e.preventDefault()
        router.push('/memo/new')
        return
      }

      // `/` — 검색 포커스
      if (k === '/') {
        const target = document.querySelector<HTMLInputElement>(
          '[data-shortcut="search"], input[type="search"], input[placeholder*="검색"]'
        )
        if (target) {
          e.preventDefault()
          target.focus()
          target.select?.()
        }
        return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [router, open, openQuickCapture])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4"
      onClick={() => setOpen(false)}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800 sticky top-0 bg-white dark:bg-gray-900">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">키보드 단축키</h3>
          <button
            onClick={() => setOpen(false)}
            className="p-1 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
          >
            <X size={15} />
          </button>
        </div>
        <div className="px-5 py-4 space-y-1">
          {SHORTCUTS.map((s, i) => (
            <div
              key={i}
              className="flex items-center justify-between gap-3 py-2 border-b border-gray-100 dark:border-gray-800 last:border-0"
            >
              <span className="text-sm text-gray-700 dark:text-gray-300">{s.label}</span>
              <div className="flex items-center gap-1">
                {s.keys.map((key, j) => (
                  <span key={j} className="inline-flex items-center">
                    <kbd className="min-w-[24px] px-1.5 py-0.5 text-[11px] font-mono font-semibold bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded text-gray-700 dark:text-gray-300 text-center">
                      {key}
                    </kbd>
                    {j < s.keys.length - 1 && <span className="mx-1 text-gray-400 text-xs">+</span>}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="px-5 py-3 text-[11px] text-gray-400 dark:text-gray-500 bg-gray-50 dark:bg-gray-950/30 rounded-b-2xl">
          💡 <kbd className="px-1 py-0.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded font-mono">G</kbd>{' '}
          누른 뒤 0.7초 안에 다른 키를 누르면 페이지 이동
        </div>
      </div>
    </div>
  )
}
