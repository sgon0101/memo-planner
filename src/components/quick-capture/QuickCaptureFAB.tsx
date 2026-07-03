'use client'

/**
 * Quick Capture FAB (Speed Dial)
 *
 * 디자인 의도:
 *  - 단일 탭 → 메모/플랜 미니 버튼 두 개로 펼침
 *  - 미니 버튼 탭 → 해당 모드로 모달 오픈 (탭 한 번 줄어듦)
 *  - 외부 탭/Esc/백드롭 탭 → 닫힘
 *  - 펼친 상태에서 메인 버튼은 45도 회전 (+ → ✕ 시각 변형)
 *
 * 위치:
 *  - 모바일: bottom-20 (MobileNav h-14 위) + right-4
 *  - 데스크탑: bottom-6 right-6, 좀 더 작게
 */

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Plus, FileText, Calendar } from 'lucide-react'
import { useUIStore } from '@/store/uiStore'
import { cn } from '@/lib/utils'

export default function QuickCaptureFAB() {
  // AI 대화 페이지에선 입력창 send 버튼과 겹쳐서 UX 방해 — FAB 숨김
  const pathname = usePathname()
  const hideFAB = pathname?.startsWith('/insights')

  const open = useUIStore((s) => s.openQuickCapture)
  const modalOpen = useUIStore((s) => s.quickCaptureOpen)
  const [expanded, setExpanded] = useState(false)
  // FAB이 텍스트 위에 있는지 — 실시간 감지 (스크롤 무관)
  const [overText, setOverText] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const fabBtnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 모달 열림 시 FAB 접기 (의도된 패턴)
    if (modalOpen && expanded) setExpanded(false)
  }, [modalOpen, expanded])

  // FAB 뒤에 텍스트가 있는지 감지 — 있으면 반투명, 없으면 불투명
  // elementsFromPoint로 FAB 아래 스택을 보고, 텍스트성 element가 있는지 확인
  useEffect(() => {
    let rafId: number | null = null
    let postTimer: ReturnType<typeof setTimeout> | null = null

    const TEXT_TAGS = new Set([
      'P', 'SPAN', 'A', 'LI', 'TD', 'TH', 'BUTTON', 'LABEL',
      'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'STRONG', 'EM', 'B', 'I', 'CODE', 'BLOCKQUOTE', 'MARK',
    ])

    function elementHasVisibleText(el: Element): boolean {
      // 자기 자신 또는 가까운 조상이 텍스트 태그이고 textContent 있으면 true
      let cur: Element | null = el
      let depth = 0
      while (cur && depth < 5) {
        if (TEXT_TAGS.has(cur.tagName)) {
          const txt = (cur.textContent ?? '').trim()
          if (txt.length > 0) return true
        }
        cur = cur.parentElement
        depth++
      }
      return false
    }

    function check() {
      const fab = fabBtnRef.current
      if (!fab) { setOverText(false); return }
      const r = fab.getBoundingClientRect()
      if (r.width === 0 || r.height === 0) { setOverText(false); return }

      // FAB 영역의 5점 샘플링 (가운데 + 모서리 안쪽)
      const pad = 6
      const points: [number, number][] = [
        [r.left + r.width / 2, r.top + r.height / 2],
        [r.left + pad,         r.top + pad],
        [r.right - pad,        r.top + pad],
        [r.left + pad,         r.bottom - pad],
        [r.right - pad,        r.bottom - pad],
      ]

      for (const [x, y] of points) {
        if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) continue
        const stack = typeof document.elementsFromPoint === 'function'
          ? document.elementsFromPoint(x, y)
          : []
        // FAB과 그 자식들 제외하고 첫 element가 텍스트성인지 확인
        const underneath = stack.find((el) => el !== fab && !fab.contains(el) && !wrapperRef.current?.contains(el))
        if (underneath && elementHasVisibleText(underneath)) {
          setOverText(true)
          return
        }
      }
      setOverText(false)
    }

    function schedule() {
      if (rafId !== null) return
      rafId = requestAnimationFrame(() => {
        rafId = null
        check()
      })
    }

    // 초기 진입 후 1프레임 늦게 — 레이아웃 안정화
    requestAnimationFrame(check)
    // 스크롤 끝난 직후에도 한 번 더 확인 (rAF가 마지막 위치 못 잡을 수 있어서)
    function onScroll() {
      schedule()
      if (postTimer) clearTimeout(postTimer)
      postTimer = setTimeout(check, 120)
    }

    window.addEventListener('scroll', onScroll, { passive: true, capture: true })
    window.addEventListener('resize', schedule)
    // pathname 변화 등은 SPA navigation으로 layout 변경 → MutationObserver로 body 변화 감지
    const mo = new MutationObserver(() => schedule())
    mo.observe(document.body, { childList: true, subtree: true, characterData: true })

    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', schedule)
      mo.disconnect()
      if (rafId !== null) cancelAnimationFrame(rafId)
      if (postTimer) clearTimeout(postTimer)
    }
  }, [])

  useEffect(() => {
    if (!expanded) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setExpanded(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expanded])

  function handleSelect(mode: 'memo' | 'plan') {
    setExpanded(false)
    requestAnimationFrame(() => open(mode))
  }

  if (modalOpen) return null

  if (hideFAB) return null

  return (
    <>
      {expanded && (
        <div
          className="fixed inset-0 z-30 bg-black/30 backdrop-blur-[2px]"
          onClick={() => setExpanded(false)}
          aria-hidden
        />
      )}

      <div
        ref={wrapperRef}
        className="fixed z-40 bottom-20 right-4 md:bottom-6 md:right-6 flex flex-col items-end gap-2.5"
      >
        <div
          className={cn(
            'flex flex-col items-end gap-2 transition-all duration-200 origin-bottom-right',
            expanded
              ? 'opacity-100 translate-y-0 scale-100 pointer-events-auto'
              : 'opacity-0 translate-y-3 scale-90 pointer-events-none',
          )}
        >
          <SubButton
            icon={<FileText size={15} />}
            label="메모"
            accent="bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-400"
            onClick={() => handleSelect('memo')}
          />
          <SubButton
            icon={<Calendar size={15} />}
            label="플랜"
            accent="bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400"
            onClick={() => handleSelect('plan')}
          />
        </div>

        <button
          ref={fabBtnRef}
          onClick={() => setExpanded((v) => !v)}
          className={cn(
            'flex items-center justify-center rounded-full bg-violet-600 hover:bg-violet-700 text-white shadow-lg shadow-violet-500/30 transition-all duration-300 active:scale-95',
            'w-14 h-14 md:w-12 md:h-12',
            expanded && 'rotate-45',
            // FAB 뒤에 텍스트가 있으면 반투명 → 글씨가 비침. 펼치거나 hover/active 시 즉시 복원.
            overText && !expanded && 'opacity-40 hover:opacity-100 focus-visible:opacity-100 active:opacity-100',
          )}
          aria-label={expanded ? '캡처 메뉴 닫기' : '빠른 캡처 (메모/플랜)'}
          aria-expanded={expanded}
        >
          <Plus size={22} strokeWidth={2.5} />
        </button>
      </div>
    </>
  )
}

function SubButton({
  icon, label, accent, onClick,
}: {
  icon: React.ReactNode
  label: string
  accent: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2.5 pl-2 pr-4 py-2 rounded-full bg-white dark:bg-gray-800 shadow-lg border border-gray-100 dark:border-gray-700 text-sm font-medium text-gray-800 dark:text-gray-200 active:scale-95 hover:bg-gray-50 transition-all"
    >
      <span className={cn('w-8 h-8 rounded-full flex items-center justify-center', accent)}>
        {icon}
      </span>
      {label}
    </button>
  )
}
