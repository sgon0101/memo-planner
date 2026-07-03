'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

const HOUR_OPTIONS = Array.from({ length: 24 }, (_, i) => ({
  value: i,
  label: i.toString().padStart(2, '0'),
}))

const MINUTE_OPTIONS = [0, 15, 30, 45].map((m) => ({
  value: m,
  label: m.toString().padStart(2, '0'),
}))

interface TimePickerProps {
  label: string
  value: string
  onChange: (value: string) => void
  className?: string
}

interface Option {
  value: number
  label: string
}

interface PickerProps {
  value: number
  options: Option[]
  onChange: (v: number) => void
  ariaLabel: string
}

function Picker({ value, options, onChange, ariaLabel }: PickerProps) {
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState<{ top: number; left: number; width: number; maxH: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const selected = options.find((o) => o.value === value) ?? options[0]

  const updateCoords = useCallback(() => {
    const b = btnRef.current?.getBoundingClientRect()
    if (!b) return
    const margin = 8
    const vh = window.innerHeight
    const desiredH = 240  // max-h-60
    // 아래 공간 충분하면 아래로, 부족하면 위로 flip
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
      if (btnRef.current?.contains(t) || panelRef.current?.contains(t)) return
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
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          'flex items-center justify-between gap-1 px-2.5 py-1.5 text-sm rounded-lg border',
          'border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800',
          'text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-violet-500',
          'min-w-[58px] transition-colors',
          open && 'ring-2 ring-violet-500',
        )}
      >
        <span className="font-medium tabular-nums">{selected.label}</span>
        <ChevronDown size={12} className={cn('text-gray-400 transition-transform', open && 'rotate-180')} />
      </button>
      {open && coords && typeof window !== 'undefined' && createPortal(
        <div
          ref={panelRef}
          role="listbox"
          aria-label={ariaLabel}
          className="fixed z-[200] overflow-y-auto bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl py-1"
          style={{ top: coords.top, left: coords.left, width: coords.width, maxHeight: coords.maxH }}
        >
          {options.map((o) => {
            const isSel = o.value === value
            return (
              <button
                key={o.value}
                type="button"
                data-selected={isSel}
                onClick={() => { onChange(o.value); setOpen(false) }}
                className={cn(
                  'w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left transition-colors tabular-nums',
                  isSel
                    ? 'bg-violet-50 dark:bg-violet-950/30 text-violet-600 dark:text-violet-400 font-semibold'
                    : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800',
                )}
              >
                <span>{o.label}</span>
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

export default function TimePicker({ label, value, onChange, className }: TimePickerProps) {
  const parts = value ? value.split(':').map(Number) : [9, 0]
  const hour = isNaN(parts[0]) ? 9 : parts[0]
  const minute = isNaN(parts[1]) ? 0 : Math.round(parts[1] / 10) * 10

  function emit(h: number, m: number) {
    onChange(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
  }

  return (
    <div className={className}>
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <div className="flex items-center gap-1.5">
        <Picker value={hour} options={HOUR_OPTIONS} onChange={(h) => emit(h, minute)} ariaLabel={`${label} 시간`} />
        <span className="text-gray-500 font-medium">:</span>
        <Picker value={minute} options={MINUTE_OPTIONS} onChange={(m) => emit(hour, m)} ariaLabel={`${label} 분`} />
      </div>
    </div>
  )
}
