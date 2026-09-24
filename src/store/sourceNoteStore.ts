'use client'

/**
 * 소스 노트 모달 상태 + 분석 요청 — 모달을 닫아도 분석 요청은 유지된다.
 *
 * 분석은 30~90초(긴 이미지는 1~3분) 걸린다. 요청을 컴포넌트가 아니라 이 스토어가 들고 있어,
 * 모달을 닫거나 다른 화면으로 가도 끝까지 진행되고, 끝나면 토스트 [확인하기]로 다시 연다.
 * (서버 캐시가 있어 다시 열어도 AI 재호출 비용은 없다)
 */

import { create } from 'zustand'
import type { UploadedSource } from '@/lib/files/uploadSources'
import type { AnalyzeResponse } from '@/lib/source-note/types'

export type AnalysisJob =
  | { status: 'idle' }
  | { status: 'running'; key: string; uploaded: UploadedSource[]; force: boolean }
  | { status: 'done'; key: string; uploaded: UploadedSource[]; response: AnalyzeResponse }
  | { status: 'error'; key: string; uploaded: UploadedSource[]; error: string }

interface SourceNoteState {
  open: boolean
  /** 드래그앤드롭 등으로 모달을 열 때 미리 넣을 파일 */
  initialFiles: File[] | null
  folderId: string | null
  job: AnalysisJob
  openModal: (opts?: { files?: File[] | null; folderId?: string | null }) => void
  /** 분석이 끝난 뒤 토스트 등에서 결과 화면으로 다시 열기 */
  reopen: () => void
  closeModal: () => void
  consumeInitialFiles: () => File[] | null
  resetJob: () => void
  runAnalysis: (uploaded: UploadedSource[], opts?: { force?: boolean; onBackgroundDone?: (ok: boolean) => void }) => Promise<void>
}

export const useSourceNoteStore = create<SourceNoteState>((set, get) => ({
  open: false,
  initialFiles: null,
  folderId: null,
  job: { status: 'idle' },

  openModal: (opts) => set((s) => ({
    open: true,
    initialFiles: opts?.files ?? null,
    folderId: opts?.folderId !== undefined ? opts.folderId : s.folderId,
    // 새 파일을 들고 오면 새로 시작. 버튼으로만 열면 진행 중·완료·실패 결과를 그대로 보여준다
    // (완료 토스트가 사라진 뒤 다시 열어도 결과·오류 메시지를 잃지 않도록 — E2E에서 발견)
    job: opts?.files?.length && s.job.status !== 'running' ? { status: 'idle' } : s.job,
  })),
  reopen: () => set({ open: true, initialFiles: null }),
  closeModal: () => set({ open: false, initialFiles: null }),
  consumeInitialFiles: () => {
    const files = get().initialFiles
    if (files) set({ initialFiles: null })
    return files
  },
  resetJob: () => set({ job: { status: 'idle' } }),

  runAnalysis: async (uploaded, opts) => {
    const key = uploaded.map((u) => u.fileId).join(',') + (opts?.force ? ':force' : '')
    set({ job: { status: 'running', key, uploaded, force: !!opts?.force } })
    let next: AnalysisJob
    try {
      const res = await fetch('/api/ai/source-note/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileIds: uploaded.map((u) => u.fileId), force: !!opts?.force }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        next = { status: 'error', key, uploaded, error: data?.error || `분석에 실패했어요 (${res.status}).` }
      } else {
        next = { status: 'done', key, uploaded, response: data as AnalyzeResponse }
      }
    } catch {
      next = { status: 'error', key, uploaded, error: '네트워크 오류로 분석하지 못했어요. 다시 시도해주세요.' }
    }
    // 그 사이 다른 분석이 시작됐으면 덮어쓰지 않는다
    const cur = get().job
    if (cur.status !== 'running' || cur.key !== key) return
    set({ job: next })
    if (!get().open) opts?.onBackgroundDone?.(next.status === 'done')
  },
}))
