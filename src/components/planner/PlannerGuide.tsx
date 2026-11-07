'use client'

/** 플래너 첫 사용 안내 — 실제로 해낸 단계에 체크 (lib/planner/guide.ts 참고) */

import { useEffect, useState } from 'react'
import { Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { readGuide, dismissGuide, subscribeGuide, type GuideStep } from '@/lib/planner/guide'

const STEPS: { id: GuideStep; label: string; hint: string }[] = [
  { id: 'capture', label: '머릿속 일을 적기', hint: '위 입력창에 적고 Enter' },
  { id: 'schedule', label: '시간 정하기', hint: '캘린더로 끌거나, 눌러서 시간 고르기' },
  { id: 'complete', label: '끝내고 체크하기', hint: '오늘 할 일을 다 비우면 하루 마감이 열려요' },
]

export default function PlannerGuide() {
  const [state, setState] = useState(() => (typeof window === 'undefined' ? null : readGuide()))
  useEffect(() => subscribeGuide(() => setState(readGuide())), [])
  if (!state || state.dismissed) return null
  const doneCount = STEPS.filter((s) => state.done[s.id]).length
  const allDone = doneCount === STEPS.length

  return (
    <section aria-label="플래너 사용 안내" className="mx-3 mb-2 rounded-xl border border-violet-200 dark:border-violet-900 bg-violet-50/60 dark:bg-violet-950/20 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <p className="flex-1 text-xs font-semibold text-violet-800 dark:text-violet-300">
          {allDone ? '준비 끝! 이제 이렇게 쓰면 돼요' : `직접 해보면서 익혀요 · ${doneCount}/3`}
        </p>
        <button type="button" onClick={dismissGuide} aria-label="안내 닫기" className="w-8 h-8 -mr-1 flex items-center justify-center rounded-lg text-violet-500 hover:bg-violet-100 dark:hover:bg-violet-900/40">
          <X size={14} />
        </button>
      </div>
      <ol className="mt-1 space-y-1">
        {STEPS.map((s, i) => {
          const done = state.done[s.id]
          return (
            <li key={s.id} className="flex items-start gap-2 text-xs">
              <span
                className={cn(
                  'mt-0.5 w-4 h-4 flex-shrink-0 rounded-full flex items-center justify-center text-[10px] font-bold',
                  done ? 'bg-violet-600 text-white' : 'border border-violet-300 text-violet-500 dark:border-violet-700',
                )}
                aria-hidden="true"
              >
                {done ? <Check size={10} strokeWidth={3} /> : i + 1}
              </span>
              <span className={cn('flex-1', done && 'text-gray-400 line-through')}>
                <span className="font-medium text-gray-800 dark:text-gray-200">{s.label}</span>
                {!done && <span className="block text-gray-500 dark:text-gray-400">{s.hint}</span>}
              </span>
              <span className="sr-only">{done ? '완료' : '미완료'}</span>
            </li>
          )
        })}
      </ol>
    </section>
  )
}
