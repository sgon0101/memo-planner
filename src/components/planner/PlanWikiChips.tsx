'use client'

/**
 * 플랜 위키 칩 (2026-11, 0023 plans.wiki_links).
 * 제목에 [[ ]]를 쓰지 않고 칩으로 단다. 후보는 메모장에서 쓰는 위키(사용 많은 순)라
 * 같은 허브로 모이고, 표기만 다른 입력('행동 경제학')은 기존 대표 표기로 맞춘다.
 */

import { useMemo, useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAllMemosMeta } from '@/hooks/useAllMemosMeta'
import { wikiKey } from '@/lib/wiki/normalize'
import { cleanWikiList, MAX_PLAN_WIKIS } from '@/lib/planner/titleTokens'

interface PlanWikiChipsProps {
  value: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
  className?: string
  /** 지난 플랜에서 추천한 위키 (lib/planner/planHints) — 눌러서 추가 */
  suggestions?: string[]
}

export default function PlanWikiChips({ value, onChange, disabled, className, suggestions: recommended = [] }: PlanWikiChipsProps) {
  const { allWikiLinks, wikiCanonical } = useAllMemosMeta()
  const [adding, setAdding] = useState(false)
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const chosen = useMemo(() => new Set(value.map(wikiKey)), [value])
  const suggestions = useMemo(() => {
    const k = wikiKey(q)
    return allWikiLinks
      .filter((w) => !chosen.has(wikiKey(w)) && (!k || wikiKey(w).includes(k)))
      .slice(0, 6)
  }, [allWikiLinks, chosen, q])

  const full = value.length >= MAX_PLAN_WIKIS

  function add(raw: string) {
    const name = raw.trim().replace(/^\[\[/, '').replace(/\]\]$/, '').trim()
    if (!name) return
    const canonical = wikiCanonical.get(wikiKey(name)) ?? name
    onChange(cleanWikiList([...value, canonical]))
    setQ('')
    setActive(0)
    if (value.length + 1 >= MAX_PLAN_WIKIS) setAdding(false)
  }

  function remove(name: string) {
    onChange(value.filter((w) => w !== name))
  }

  function close() {
    setAdding(false)
    setQ('')
    setActive(0)
  }

  return (
    <div className={cn('relative flex flex-wrap items-center gap-1.5', className)}>
      {value.map((w) => (
        <span key={w} className="inline-flex items-center gap-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-xs pl-2.5 pr-1 py-1">
          {w}
          {!disabled && (
            <button
              type="button"
              onClick={() => remove(w)}
              aria-label={`위키 '${w}' 빼기`}
              className="w-5 h-5 flex items-center justify-center rounded-full hover:bg-emerald-100 dark:hover:bg-emerald-900/50 relative before:absolute before:-inset-1.5 before:content-['']"
            >
              <X size={11} />
            </button>
          )}
        </span>
      ))}

      {!disabled && !full && !adding && recommended
        .filter((w) => !chosen.has(wikiKey(w)))
        .map((w) => (
          <button
            key={`s-${w}`}
            type="button"
            onClick={() => add(w)}
            title="지난 비슷한 플랜에 단 위키예요"
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-emerald-300 dark:border-emerald-800 text-xs text-emerald-700 dark:text-emerald-300 px-2.5 py-1 min-h-7 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
          >
            <Plus size={11} aria-hidden="true" /> {w} <span className="text-[10px] text-emerald-600/70 dark:text-emerald-400/70">추천</span>
          </button>
        ))}

      {!disabled && !full && !adding && (
        <button
          type="button"
          onClick={() => { setAdding(true); requestAnimationFrame(() => inputRef.current?.focus()) }}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-gray-300 dark:border-gray-600 text-xs text-gray-500 dark:text-gray-400 px-2.5 py-1 min-h-7 hover:border-violet-400 hover:text-violet-600"
        >
          <Plus size={11} aria-hidden="true" /> 위키
        </button>
      )}

      {adding && (
        <div className="relative">
          <label htmlFor="plan-wiki-input" className="sr-only">위키 추가</label>
          <input
            id="plan-wiki-input"
            ref={inputRef}
            type="search"
            autoComplete="off"
            data-form-type="other"
            data-1p-ignore=""
            value={q}
            placeholder="위키 이름"
            role="combobox"
            aria-expanded={suggestions.length > 0}
            aria-controls="plan-wiki-suggest"
            onChange={(e) => { setQ(e.target.value); setActive(0) }}
            onBlur={() => { if (q.trim()) add(q); close() }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return
              if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, suggestions.length - 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)) }
              else if (e.key === 'Enter') {
                e.preventDefault()
                e.stopPropagation()
                // 입력과 정확히 같은 후보가 있거나 입력이 비었으면 후보를, 아니면 입력한 이름 그대로
                const exact = suggestions.find((s) => wikiKey(s) === wikiKey(q))
                if (exact) add(exact)
                else if (q.trim()) add(q)
                else if (suggestions[active]) add(suggestions[active])
              } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close() }
              else if (e.key === 'Backspace' && !q && value.length) remove(value[value.length - 1])
            }}
            className="w-32 rounded-full border border-violet-300 dark:border-violet-700 bg-white dark:bg-gray-800 px-2.5 py-1 text-xs outline-none [&::-webkit-search-cancel-button]:hidden"
          />
          {suggestions.length > 0 && (
            <ul
              id="plan-wiki-suggest"
              role="listbox"
              className="absolute left-0 top-full mt-1 z-20 w-48 max-h-56 overflow-y-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg py-1"
            >
              {suggestions.map((s, i) => (
                <li key={s} role="option" aria-selected={i === active}>
                  <button
                    type="button"
                    // blur보다 먼저 — 클릭이 blur(입력 그대로 추가)에 먹히지 않게
                    onMouseDown={(e) => { e.preventDefault(); add(s) }}
                    className={cn(
                      'w-full text-left px-3 py-2 text-sm truncate',
                      i === active ? 'bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300' : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/60',
                    )}
                  >
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
