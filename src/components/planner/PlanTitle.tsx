'use client'

/**
 * 플랜 제목 렌더 — [[위키]]·#태그를 칩으로 (2026-11 플래너 개선 1차).
 * 데이터는 제목 문자열 그대로 두고 표시만 바꾼다(스키마 변경 없음).
 */

import { Fragment } from 'react'
import { cn } from '@/lib/utils'
import { splitPlanTitle } from '@/lib/planner/titleTokens'

export default function PlanTitle({ title, className, chips = true, wikis }: { title: string; className?: string; chips?: boolean; wikis?: readonly string[] }) {
  // 위키 칩(plans.wiki_links)은 제목 뒤에 붙여 같은 모양으로 — 제목 속 [[위키]]와 겹치면 한 번만
  const parts = splitPlanTitle(title)
  const inTitle = new Set(parts.filter((p) => p.kind === 'wiki').map((p) => p.text))
  if (chips) for (const w of wikis ?? []) if (!inTitle.has(w)) parts.push({ text: w, kind: 'wiki' })
  return (
    <span className={className}>
      {parts.map((p, i) => {
        if (p.kind === 'text' || !chips) {
          return <Fragment key={i}>{p.kind === 'wiki' ? p.text : p.kind === 'tag' ? `#${p.text}` : p.text}</Fragment>
        }
        return (
          <span
            key={i}
            className={cn(
              'inline-block align-baseline mx-0.5 px-1.5 rounded-full text-[0.85em] leading-snug',
              p.kind === 'wiki'
                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                : 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
            )}
          >
            {p.kind === 'wiki' ? p.text : `#${p.text}`}
          </span>
        )
      })}
    </span>
  )
}
