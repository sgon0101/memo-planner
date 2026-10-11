'use client'

/**
 * 즐겨찾기(플랜 템플릿) 칩 — PlanFormModal / QuickCaptureModal 공용 (2026-10-11 UX 2차)
 *
 * 이전 문제: 삭제 버튼이 hover에서만 보여 터치 기기에선 접근 불가, 16px로 작고, 라벨 없음.
 * - 터치 기기(hover:none)에선 항상 표시, 데스크톱은 hover/키보드 포커스 시 표시
 * - 시각 20px + 투명 히트 영역 28px
 * - 실수로 눌러도 되돌리기 토스트로 복구 (deleteTemplateWithUndo)
 */

import { X } from 'lucide-react'
import type { PlanTemplate } from '@/types'

interface TemplateChipProps {
  template: PlanTemplate
  onApply: (t: PlanTemplate) => void
  onDelete: (t: PlanTemplate) => void
}

export function TemplateChip({ template: t, onApply, onDelete }: TemplateChipProps) {
  return (
    <div className="group relative flex items-center">
      <button
        type="button"
        onClick={() => onApply(t)}
        className="flex items-center gap-1 min-h-8 pl-2 pr-2 py-1 text-xs rounded-lg border border-gray-200 dark:border-gray-700 hover:border-violet-400 text-gray-600 dark:text-gray-300 transition-colors"
        style={{ borderLeftColor: t.color, borderLeftWidth: 3 }}
      >
        <span>{t.title}</span>
        {!t.isAllDay && t.startTime && (
          <span className="text-gray-400 ml-0.5">{t.startTime.slice(0, 5)}</span>
        )}
      </button>
      <button
        type="button"
        onClick={() => onDelete(t)}
        aria-label={`즐겨찾기 '${t.title}' 삭제`}
        className={
          'absolute -top-2 -right-2 hidden group-hover:flex group-focus-within:flex [@media(hover:none)]:flex ' +
          'items-center justify-center w-5 h-5 rounded-full bg-gray-500 hover:bg-gray-600 text-white ' +
          "before:absolute before:-inset-1 before:content-[''] " +
          'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-violet-500'
        }
      >
        <X size={11} strokeWidth={2.5} aria-hidden />
      </button>
    </div>
  )
}
