'use client'

import { useEffect } from 'react'
import {
  addDays, subDays, addWeeks, subWeeks, addMonths, subMonths,
  startOfWeek, endOfWeek, parseISO, format, isSameMonth,
} from 'date-fns'

/**
 * useCalendarKeyboard — 캘린더 키보드 네비게이션
 *
 * 키맵:
 *   ←  / →   : 1일 전/후
 *   ↑  / ↓   : 1주 전/후
 *   PageUp/Down : 1개월 전/후
 *   Home / End  : 선택 주의 일요일 / 토요일
 *   t / T       : 오늘
 *   n / N       : 새 플랜 (onNewPlan 콜백)
 *
 * 동작:
 *   - input/textarea/contenteditable에 focus되어 있으면 비활성
 *   - selectedDate 없으면 today를 기준으로 시작 (네비 후 selectedDate 갱신)
 *   - selectedDate가 currentMonth 밖으로 이동하면 currentMonth도 따라 갱신
 */

interface Args {
  enabled: boolean
  selectedDate: string                       // 'yyyy-MM-dd' or ''
  currentMonth: Date
  selectDate: (d: string) => void
  setCurrentMonth: (d: Date) => void
  setCurrentWeek: (d: Date) => void
  goToToday: () => void
  onNewPlan?: () => void
}

function isTypingTarget(t: EventTarget | null): boolean {
  if (!t || !(t instanceof HTMLElement)) return false
  if (t.isContentEditable) return true
  const tag = t.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

export function useCalendarKeyboard({
  enabled,
  selectedDate,
  currentMonth,
  selectDate,
  setCurrentMonth,
  setCurrentWeek,
  goToToday,
  onNewPlan,
}: Args) {
  useEffect(() => {
    if (!enabled) return

    function handler(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return
      // 보조키 조합은 무시 (브라우저 단축키와 충돌 방지)
      if (e.metaKey || e.ctrlKey || e.altKey) return

      const today = format(new Date(), 'yyyy-MM-dd')
      const base = selectedDate ? parseISO(selectedDate) : new Date()

      function jumpTo(d: Date) {
        const str = format(d, 'yyyy-MM-dd')
        selectDate(str)
        // 다른 월로 이동했다면 currentMonth도 갱신
        if (!isSameMonth(d, currentMonth)) {
          setCurrentMonth(d)
        }
        // 주뷰 기준점도 갱신
        setCurrentWeek(startOfWeek(d, { weekStartsOn: 0 }))
      }

      switch (e.key) {
        case 'ArrowLeft':  e.preventDefault(); jumpTo(subDays(base, 1));  break
        case 'ArrowRight': e.preventDefault(); jumpTo(addDays(base, 1));  break
        case 'ArrowUp':    e.preventDefault(); jumpTo(subWeeks(base, 1)); break
        case 'ArrowDown':  e.preventDefault(); jumpTo(addWeeks(base, 1)); break
        case 'PageUp':     e.preventDefault(); jumpTo(subMonths(base, 1)); break
        case 'PageDown':   e.preventDefault(); jumpTo(addMonths(base, 1)); break
        case 'Home':       e.preventDefault(); jumpTo(startOfWeek(base, { weekStartsOn: 0 })); break
        case 'End':        e.preventDefault(); jumpTo(endOfWeek(base, { weekStartsOn: 0 }));   break
        case 't':
        case 'T':
          e.preventDefault()
          goToToday()
          // selectedDate가 today와 다르면 today로
          if (selectedDate !== today) selectDate(today)
          break
        case 'n':
        case 'N':
          if (onNewPlan) { e.preventDefault(); onNewPlan() }
          break
      }
    }

    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [enabled, selectedDate, currentMonth, selectDate, setCurrentMonth, setCurrentWeek, goToToday, onNewPlan])
}
