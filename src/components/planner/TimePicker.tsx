'use client'

/**
 * 시간 선택기 — 직접 타이핑 + 드롭다운 quick pick 콤보
 *
 * 개선 이력 (2026-07-30):
 * 1) 45분/15분 선택이 "00"으로 표시되던 버그 수정
 *    — 기존 코드가 분을 10분 단위로 반올림(45→50, 15→20)해 옵션 목록
 *      [00,15,30,45]에 없는 값이 되고 fallback(options[0]="00")이 표시됐음.
 *      반올림을 제거하고, 목록에 없는 값도 입력창에 실제 값 그대로 표시.
 * 2) 자정 종료 지원 — allowMidnight prop: 시 옵션에 24 추가(24시 선택 시 분 00 고정).
 *    minutesToTime/뷰 좌표 계산(dragHelpers)은 이미 1440분(=24:00)을 지원함.
 * 3) 직접 타이핑 — 시/분 필드가 input이라 키보드로 바로 입력 가능
 *    (45 외의 임의 분도 허용). blur/Enter 시 정규화·clamp.
 */

import { useState, useRef, useEffect, useCallback, useId } from 'react'
import { createPortal } from 'react-dom'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

const MINUTE_QUICK = [0, 15, 30, 45]

interface TimePickerProps {
  label: string
  value: string
  onChange: (value: string) => void
  className?: string
  /** 종료 시간용 — 24:00(자정) 선택 허용 */
  allowMidnight?: boolean
}

interface ComboFieldProps {
  value: number
  options: number[]
  max: number
  onCommit: (v: number) => void
  ariaLabel: string
  disabled?: boolean
}

/**
 * 두 자리 숫자 입력 + 드롭다운 quick pick.
 * - 입력창이 곧 표시 영역 — 옵션 목록에 없는 값도 그대로 보임 (fallback 버그 원천 차단)
 * - 포커스 시 전체 선택 + 드롭다운 오픈, 숫자만 허용, blur/Enter 시 clamp 후 커밋
 * - ↑/↓ 키로 1씩 증감
 */
function ComboField({ value, options, max, onCommit, ariaLabel, disabled }: ComboFieldProps) {
  const listboxId = useId()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState<string | null>(null) // null = 표시 모드 (외부 value 사용)
  const [coords, setCoords] = useState<{ top: number; left: number; width: number; maxH: number } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const display = text ?? String(value).padStart(2, '0')

  const clamp = useCallback((n: number) => Math.max(0, Math.min(max, n)), [max])

  const commit = useCallback((raw: string | null) => {
    if (raw !== null && raw.trim() !== '') {
      const n = parseInt(raw, 10)
      if (!isNaN(n)) onCommit(clamp(n))
    }
    setText(null)
  }, [onCommit, clamp])

  const updateCoords = useCallback(() => {
    const b = inputRef.current?.getBoundingClientRect()
    if (!b) return
    const margin = 8
    const vh = window.innerHeight
    const desiredH = 240
    const spaceBelow = vh - b.bottom - margin
    const spaceAbove = b.top - margin
    let top: number
    let maxH: number
    if (spaceBelow >= 120 || spaceBelow >= spaceAbove) {
      top = b.bottom + 4
      maxH = Math.min(desiredH, spaceBelow - 4)
    } else {
      maxH = Math.min(desiredH, spaceAbove - 4)
      top = b.top - maxH - 4
    }
    setCoords({ top, left: b.left, width: Math.max(b.width, 76), maxH })
  }, [])

  useEffect(() => {
    if (!open) return
    updateCoords()
    function onDown(e: MouseEvent | TouchEvent) {
      const t = e.target as Node
      if (inputRef.current?.contains(t) || panelRef.current?.contains(t)) return
      setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    function onWin() { updateCoords() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', onWin)
    window.addEventListener('scroll', onWin, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onWin)
      window.removeEventListener('scroll', onWin, true)
    }
  }, [open, updateCoords])

  useEffect(() => {
    if (!open || !panelRef.current) return
    const el = panelRef.current.querySelector<HTMLButtonElement>('[data-selected="true"]')
    el?.scrollIntoView({ block: 'center', behavior: 'auto' })
  }, [open])

  return (
    <>
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={display}
        disabled={disabled}
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onFocus={(e) => {
          if (disabled) return
          setText(String(value).padStart(2, '0'))
          setOpen(true)
          const target = e.target
          requestAnimationFrame(() => target.select())
        }}
        onClick={() => { if (!disabled && !open) setOpen(true) }}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, '').slice(0, 2)
          setText(digits)
        }}
        onBlur={() => { commit(text); setOpen(false) }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(text); setOpen(false); inputRef.current?.blur() }
          else if (e.key === 'ArrowUp') { e.preventDefault(); onCommit(clamp(value + 1)); setText(null) }
          else if (e.key === 'ArrowDown') { e.preventDefault(); onCommit(clamp(value - 1)); setText(null) }
        }}
        className={cn(
          'w-[52px] px-2 py-1.5 text-sm text-center font-medium tabular-nums rounded-lg border',
          'border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800',
          'text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-violet-500',
          'transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
          open && 'ring-2 ring-violet-500',
        )}
      />
      {open && coords && typeof window !== 'undefined' && createPortal(
        <div
          ref={panelRef}
          id={listboxId}
          role="listbox"
          aria-label={ariaLabel}
          className="fixed z-[200] overflow-y-auto bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl py-1"
          style={{ top: coords.top, left: coords.left, width: coords.width, maxHeight: coords.maxH }}
        >
          {options.map((o) => {
            const isSel = o === value
            return (
              <button
                key={o}
                type="button"
                data-selected={isSel}
                // mousedown에서 처리 — input blur(commit)보다 먼저 실행되도록
                onMouseDown={(e) => {
                  e.preventDefault()
                  setText(null)
                  onCommit(o)
                  setOpen(false)
                  inputRef.current?.blur()
                }}
                className={cn(
                  'w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left transition-colors tabular-nums',
                  isSel
                    ? 'bg-violet-50 dark:bg-violet-950/30 text-violet-600 dark:text-violet-400 font-semibold'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800',
                )}
              >
                <span>{String(o).padStart(2, '0')}</span>
                {isSel && <Check size={14} className="text-violet-500" />}
              </button>
            )
          })}
        </div>,
        document.body,
      )}
    </>
  )
}

export default function TimePicker({ label, value, onChange, className, allowMidnight }: TimePickerProps) {
  const maxHour = allowMidnight ? 24 : 23
  const parts = value ? value.split(':').map(Number) : [9, 0]
  const rawHour = isNaN(parts[0]) ? 9 : parts[0]
  const hour = Math.max(0, Math.min(maxHour, rawHour))
  // 분은 반올림 없이 그대로 (0~59 clamp만) — 45/15가 00으로 표시되던 버그의 원인 제거
  const rawMinute = isNaN(parts[1]) ? 0 : parts[1]
  const minute = hour === 24 ? 0 : Math.max(0, Math.min(59, rawMinute))

  const hourOptions = Array.from({ length: maxHour + 1 }, (_, i) => i)

  function emit(h: number, m: number) {
    // 24시(자정)는 24:00 고정
    const mm = h === 24 ? 0 : m
    onChange(`${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`)
  }

  return (
    <div className={className}>
      <p className="text-xs text-gray-500 mb-1">
        {label}
        <span className="ml-1.5 text-[10px] text-gray-400">직접 입력 가능</span>
      </p>
      <div className="flex items-center gap-1.5">
        <ComboField value={hour} options={hourOptions} max={maxHour} onCommit={(h) => emit(h, minute)} ariaLabel={`${label} 시`} />
        <span className="text-gray-500 font-medium">:</span>
        <ComboField value={minute} options={MINUTE_QUICK} max={59} onCommit={(m) => emit(hour, m)} ariaLabel={`${label} 분`} disabled={hour === 24} />
      </div>
    </div>
  )
}
