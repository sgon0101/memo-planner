'use client'

/**
 * 파일로 노트 — PDF 1개 또는 이미지 1~20장을 올려 요약 노트를 만든다.
 *
 * 상태 머신:
 *   select → precheck → arrange(이미지 2장+) → uploading(%) → analyzing → review → creating → 완료
 *                                               ↘ duplicate          ↘ error(재시도)
 *
 * - precheck는 클라이언트에서: PDF 쪽수(pdf-lib) / 이미지 치수(헤더 파싱만 — 디코딩 금지) →
 *   서버와 같은 computeTiles로 조각 수 합계를 계산해 업로드 전에 차단한다.
 * - 분석 요청은 sourceNoteStore가 들고 있어 모달을 닫아도 계속된다.
 * - AI 결과는 검토 화면에서 확인·수정한 뒤에만 메모가 된다.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { Drawer } from 'vaul'
import {
  AlertTriangle, ArrowLeft, ArrowRight, Check, FileText, FileUp, GripVertical, Image as ImageIcon,
  Loader2, Plus, RefreshCw, X,
} from 'lucide-react'
import Modal from '@/components/ui/Modal'
import { toast } from '@/components/ui/Toast'
import WikiSuggest from './WikiSuggest'
import TagSuggest from './TagSuggest'
import { cn } from '@/lib/utils'
import { memoKeys } from '@/hooks/useMemos'
import { useFolderStore } from '@/store/folderStore'
import { useSourceNoteStore } from '@/store/sourceNoteStore'
import { uploadSources, type UploadedSource } from '@/lib/files/uploadSources'
import {
  MAX_IMAGE_BYTES, MAX_IMAGE_COUNT, MAX_PDF_BYTES, MAX_PDF_PAGES, SOURCE_IMAGE_TYPES, SOURCE_PDF_TYPE, formatBytes,
} from '@/lib/files/sourceLimits'
import { CHUNK_THRESHOLD, MAX_SET_TILES, countTiles } from '@/lib/source-note/computeTiles'
import { readImageDims } from '@/lib/source-note/imageHeader'
import { tagKey, wikiKey } from '@/lib/wiki/normalize'
import type { AnalyzeResponse, NoteSuggestion } from '@/lib/source-note/types'

export const SOURCE_ACCEPT = 'application/pdf,image/png,image/jpeg,image/webp'

/** 썸네일 미리보기를 만들 최대 픽셀 — 이보다 크면 모바일 디코딩이 위험해 자리표시만 */
const PREVIEW_MAX_PIXELS = 20_000_000

interface PickedFile {
  key: string
  file: File
  width?: number
  height?: number
  tiles?: number
  previewUrl?: string
}

type Stage = 'select' | 'precheck' | 'arrange' | 'uploading' | 'duplicate' | 'analyzing' | 'review' | 'creating' | 'error'

interface ChipState extends NoteSuggestion {
  id: string
  selected: boolean
}

const ANALYZE_STEPS = ['자료를 읽는 중…', '구조를 정리하는 중…', '개념을 연결하는 중…']

export default function SourceNoteModal() {
  const open = useSourceNoteStore((s) => s.open)
  const closeModal = useSourceNoteStore((s) => s.closeModal)
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const update = () => setIsMobile(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  if (!open) return null

  if (isMobile) {
    return (
      <Drawer.Root open onOpenChange={(o) => { if (!o) closeModal() }}>
        <Drawer.Portal>
          <Drawer.Overlay className="fixed inset-0 bg-black/40 z-40" />
          <Drawer.Content className="fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-gray-900 rounded-t-2xl shadow-2xl flex flex-col max-h-[92vh] outline-none">
            <div className="mx-auto mt-2.5 mb-1 h-1.5 w-10 shrink-0 rounded-full bg-gray-300 dark:bg-gray-600" />
            <Drawer.Title className="sr-only">파일로 노트 만들기</Drawer.Title>
            <SourceNoteBody onClose={closeModal} />
          </Drawer.Content>
        </Drawer.Portal>
      </Drawer.Root>
    )
  }

  return (
    <Modal onClose={closeModal} ariaLabel="파일로 노트 만들기" panelClassName="w-full max-w-2xl p-0 overflow-hidden">
      <div className="flex max-h-[85vh] flex-col">
        <SourceNoteBody onClose={closeModal} />
      </div>
    </Modal>
  )
}

function SourceNoteBody({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const folders = useFolderStore((s) => s.folders)
  const {
    job, folderId: defaultFolderId, runAnalysis, resetJob, consumeInitialFiles, reopen,
  } = useSourceNoteStore()

  const [stage, setStage] = useState<Stage>(() => {
    if (job.status === 'running') return 'analyzing'
    if (job.status === 'done') return 'review'
    if (job.status === 'error') return 'error'
    return 'select'
  })
  const [picked, setPicked] = useState<PickedFile[]>([])
  const [pdfPages, setPdfPages] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(job.status === 'error' ? job.error : null)
  const [notice, setNotice] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [uploaded, setUploaded] = useState<UploadedSource[] | null>(job.status !== 'idle' ? job.uploaded : null)
  const [duplicateOf, setDuplicateOf] = useState<{ id: string; title: string; inTrash: boolean } | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // 미리보기 URL 정리
  const pickedRef = useRef(picked)
  useEffect(() => { pickedRef.current = picked }, [picked])
  useEffect(() => () => { pickedRef.current.forEach((p) => p.previewUrl && URL.revokeObjectURL(p.previewUrl)) }, [])

  // 스토어 분석 상태 → 화면 단계
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- 외부 스토어(분석 요청) 진행을 단계로 반영 (의도된 동기화) */
    if (job.status === 'running') setStage('analyzing')
    else if (job.status === 'done') setStage((s) => (s === 'creating' ? s : 'review'))
    else if (job.status === 'error') { setError(job.error); setStage('error') }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [job])

  const onBackgroundDone = useCallback((ok: boolean) => {
    const open = () => {
      reopen()
      // 모달 호스트(MemoList)는 /memo에만 있다
      if (window.location.pathname !== '/memo') router.push('/memo')
    }
    if (ok) toast.success('분석 완료 — 확인해 보세요', { action: { label: '확인하기', onClick: open } })
    else toast.error('파일 분석에 실패했어요', { action: { label: '열기', onClick: open } })
  }, [reopen, router])

  // ── precheck ──
  const precheck = async (files: File[]) => {
    setError(null)
    setNotice(null)
    if (files.length === 0) return
    setStage('precheck')
    try {
      if (files.some((f) => /heic|heif/i.test(f.type) || /\.hei[cf]$/i.test(f.name))) {
        throw new Error('HEIC 사진은 아직 지원하지 않아요. 갤러리에서 JPG로 공유하거나 캡처 이미지를 선택해 주세요.')
      }
      const unsupported = files.find((f) => f.type !== SOURCE_PDF_TYPE && !SOURCE_IMAGE_TYPES.has(f.type))
      if (unsupported) throw new Error(`지원하지 않는 형식이에요: ${unsupported.name} (PDF·PNG·JPG·WebP만 가능)`)
      const pdfs = files.filter((f) => f.type === SOURCE_PDF_TYPE)
      if (pdfs.length && pdfs.length !== files.length) throw new Error('PDF와 이미지는 함께 올릴 수 없어요. 따로 올려주세요.')

      if (pdfs.length) {
        if (pdfs.length > 1) throw new Error('PDF는 한 번에 1개만 요약할 수 있어요.')
        const pdf = pdfs[0]
        if (pdf.size > MAX_PDF_BYTES) throw new Error(`${pdf.name} — ${formatBytes(pdf.size)}, PDF는 ${formatBytes(MAX_PDF_BYTES)}까지예요.`)
        const { PDFDocument } = await import('pdf-lib')
        let pages: number
        try {
          const doc = await PDFDocument.load(await pdf.arrayBuffer(), { ignoreEncryption: true, updateMetadata: false })
          pages = doc.getPageCount()
        } catch {
          throw new Error(`${pdf.name} — PDF를 열 수 없어요. 손상됐거나 암호가 걸린 파일인지 확인해 주세요.`)
        }
        if (pages > MAX_PDF_PAGES) throw new Error(`${pdf.name} — ${pages}쪽이에요. ${MAX_PDF_PAGES}쪽 이하 PDF만 요약할 수 있어요.`)
        setPdfPages(pages)
        const one: PickedFile = { key: `${pdf.name}-${pdf.size}`, file: pdf }
        setPicked([one])
        await startUpload([one])
        return
      }

      if (files.length > MAX_IMAGE_COUNT) throw new Error(`이미지는 한 번에 ${MAX_IMAGE_COUNT}장까지예요 (선택 ${files.length}장).`)
      const big = files.find((f) => f.size > MAX_IMAGE_BYTES)
      if (big) throw new Error(`${big.name} — ${formatBytes(big.size)}, 이미지는 ${formatBytes(MAX_IMAGE_BYTES)}까지예요.`)

      const list: PickedFile[] = []
      for (const f of files) {
        const dims = await readImageDims(f)
        if (!dims || !dims.width || !dims.height) throw new Error(`${f.name} — 이미지 크기를 읽을 수 없어요.`)
        const tiles = countTiles(dims.width, dims.height)
        const previewUrl = dims.width * dims.height <= PREVIEW_MAX_PIXELS ? URL.createObjectURL(f) : undefined
        list.push({ key: `${f.name}-${f.size}-${f.lastModified}`, file: f, ...dims, tiles, previewUrl })
      }
      const total = list.reduce((s, p) => s + (p.tiles ?? 0), 0)
      if (total > MAX_SET_TILES) {
        const longest = list.reduce((a, b) => ((b.height ?? 0) > (a.height ?? 0) ? b : a))
        list.forEach((p) => p.previewUrl && URL.revokeObjectURL(p.previewUrl))
        throw new Error(`총 조각 ${total}개 — ${MAX_SET_TILES}개 이하로 줄여주세요. 가장 긴 이미지: ${longest.file.name} (${longest.width}×${longest.height})`)
      }
      if (total > CHUNK_THRESHOLD) setNotice(`긴 이미지라 분석에 1~3분 걸려요 (조각 ${total}개).`)
      // 기본 순서 = 파일명 자연 정렬 (캡처 파일명이 시간순이라)
      list.sort((a, b) => a.file.name.localeCompare(b.file.name, undefined, { numeric: true }))
      setPicked(list)
      if (list.length >= 2) setStage('arrange')
      else await startUpload(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : '파일을 확인하지 못했어요.')
      setStage('select')
    }
  }

  // ── 업로드 → 중복 확인 → 분석 ──
  const startUpload = async (list: PickedFile[]) => {
    setError(null)
    setStage('uploading')
    setProgress(0)
    try {
      const result = await uploadSources(list.map((p) => p.file), { onProgress: (pct) => setProgress(pct) })
      setUploaded(result)

      // 세트 전체가 같은 기존 노트에 같은 순서로 연결돼 있으면 중복
      if (result.every((u) => u.deduplicated)) {
        const candidates = result[0].linkedMemos.filter((m) => (m.position ?? 0) === 0)
        const dup = candidates.find((m) => result.every((u, i) => u.linkedMemos.some((l) => l.id === m.id && (l.position ?? 0) === i)))
        if (dup) {
          setDuplicateOf(dup)
          setStage('duplicate')
          return
        }
      }
      void runAnalysis(result, { onBackgroundDone })
    } catch (e) {
      const msg = e instanceof Error ? e.message : '업로드에 실패했어요.'
      setError(msg)
      toast.error(msg)
      setStage('error')
    }
  }

  const onPickFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return
    void precheck(Array.from(list))
  }

  // 드롭으로 연 경우 초기 파일
  useEffect(() => {
    const initial = consumeInitialFiles()
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 드롭으로 연 경우 마운트 시 1회 사전검사 (의도된 패턴)
    if (initial?.length && job.status === 'idle') void precheck(initial)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const retry = () => {
    setError(null)
    if (uploaded?.length) void runAnalysis(uploaded, { onBackgroundDone })
    else { resetJob(); setStage('select') }
  }

  const startOver = () => {
    picked.forEach((p) => p.previewUrl && URL.revokeObjectURL(p.previewUrl))
    setPicked([])
    setUploaded(null)
    setError(null)
    setNotice(null)
    setDuplicateOf(null)
    setPdfPages(null)
    resetJob()
    setStage('select')
  }

  const totalTiles = picked.reduce((s, p) => s + (p.tiles ?? 0), 0)

  return (
    <>
      {/* 헤더 */}
      <div className="flex items-center gap-2 border-b border-gray-200 dark:border-gray-800 px-5 py-3.5">
        <FileUp size={16} className="text-violet-600 dark:text-violet-400" />
        <h2 className="flex-1 text-sm font-semibold text-gray-900 dark:text-gray-100">파일로 노트 만들기</h2>
        <button type="button" onClick={onClose} aria-label="닫기" className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 cursor-pointer">
          <X size={16} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {error && stage !== 'error' && <ErrorBox message={error} />}
        {notice && (stage === 'arrange' || stage === 'uploading' || stage === 'analyzing') && (
          <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">{notice}</p>
        )}

        {(stage === 'select' || stage === 'precheck') && (
          <div
            onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragOver(true) } }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); onPickFiles(e.dataTransfer.files) }}
            className={cn(
              'flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors',
              dragOver ? 'border-violet-500 bg-violet-50 dark:bg-violet-950/30' : 'border-gray-300 dark:border-gray-700',
            )}
          >
            {stage === 'precheck' ? (
              <><Loader2 size={24} className="animate-spin text-violet-500" /><p className="text-sm text-gray-600 dark:text-gray-400">파일을 확인하는 중…</p></>
            ) : (
              <>
                <FileUp size={28} className="text-violet-500" />
                <div>
                  <p className="text-sm font-medium text-gray-800 dark:text-gray-200">PDF 1개 또는 이미지 여러 장</p>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    PDF {MAX_PDF_PAGES}쪽·{formatBytes(MAX_PDF_BYTES)} / 이미지 {MAX_IMAGE_COUNT}장까지 (긴 캡처·카드뉴스는 한 묶음으로)
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 cursor-pointer"
                >
                  파일 선택
                </button>
              </>
            )}
            <input
              ref={inputRef}
              type="file"
              accept={SOURCE_ACCEPT}
              multiple
              className="hidden"
              onChange={(e) => { onPickFiles(e.target.files); e.target.value = '' }}
            />
          </div>
        )}

        {stage === 'arrange' && (
          <ArrangeGrid picked={picked} setPicked={setPicked} totalTiles={totalTiles} />
        )}

        {stage === 'uploading' && (
          <div className="py-8 text-center">
            <p className="mb-3 text-sm text-gray-700 dark:text-gray-300">
              {pdfPages ? `PDF ${pdfPages}쪽` : `이미지 ${picked.length}장`} 올리는 중… {progress}%
            </p>
            <div className="mx-auto h-2 w-full max-w-sm overflow-hidden rounded-full bg-gray-200 dark:bg-gray-800">
              <div className="h-full rounded-full bg-violet-600 transition-all" style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}

        {stage === 'duplicate' && duplicateOf && (
          <div className="py-6 text-center">
            <p className="text-sm font-medium text-gray-800 dark:text-gray-200">이 파일들로 만든 노트가 이미 있어요</p>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              「{duplicateOf.title}」{duplicateOf.inTrash && ' — 휴지통에 있어요. 복원하면 다시 볼 수 있어요.'}
            </p>
            {!duplicateOf.inTrash && (
              <button
                type="button"
                onClick={() => { onClose(); resetJob(); router.push(`/memo/${duplicateOf.id}`) }}
                className="mt-4 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 cursor-pointer"
              >
                노트 열기
              </button>
            )}
          </div>
        )}

        {stage === 'analyzing' && (
          <AnalyzingView long={totalTiles > CHUNK_THRESHOLD} phase={job.status === 'running' ? job.phase : 'read'} />
        )}

        {stage === 'error' && (
          <div className="py-4">
            <ErrorBox message={error ?? '문제가 생겼어요.'} />
          </div>
        )}

        {(stage === 'review' || stage === 'creating') && job.status === 'done' && (
          <ReviewView
            response={job.response}
            uploaded={job.uploaded}
            folders={folders}
            defaultFolderId={defaultFolderId}
            creating={stage === 'creating'}
            onReanalyze={() => runAnalysis(job.uploaded, { force: true, onBackgroundDone })}
            onStartOver={startOver}
            onCreate={async (payload) => {
              setStage('creating')
              setError(null)
              try {
                const res = await fetch('/api/ai/source-note/create', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ sourceAnalysisId: job.response.analysisId, ...payload }),
                })
                const data = await res.json().catch(() => ({}))
                if (!res.ok || !data.memoId) throw new Error(data?.error || '노트를 만들지 못했어요.')
                await Promise.all([
                  queryClient.invalidateQueries({ queryKey: memoKeys.all() }),
                  queryClient.invalidateQueries({ queryKey: ['memos-meta-global'] }),
                  queryClient.invalidateQueries({ queryKey: ['home-memos'] }),
                ])
                resetJob()
                onClose()
                toast.success('노트를 만들었어요')
                router.push(`/memo/${data.memoId}`)
              } catch (e) {
                const msg = e instanceof Error ? e.message : '노트를 만들지 못했어요.'
                setError(msg)
                toast.error(msg)
                setStage('review')
              }
            }}
          />
        )}
      </div>

      {/* 하단 버튼 (단계별) */}
      {(stage === 'arrange' || stage === 'error' || stage === 'duplicate' || stage === 'analyzing') && (
        <div className="flex items-center justify-end gap-2 border-t border-gray-200 dark:border-gray-800 px-5 py-3">
          {stage === 'analyzing' && (
            <p className="mr-auto text-xs text-gray-500 dark:text-gray-400">창을 닫아도 분석은 계속돼요. 끝나면 알려드릴게요.</p>
          )}
          {(stage === 'arrange' || stage === 'error' || stage === 'duplicate') && (
            <button type="button" onClick={startOver} className="rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer">
              처음부터
            </button>
          )}
          {stage === 'error' && (
            <button type="button" onClick={retry} className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 cursor-pointer">
              <RefreshCw size={14} /> 다시 시도
            </button>
          )}
          {stage === 'arrange' && (
            <button
              type="button"
              disabled={picked.length === 0}
              onClick={() => void startUpload(picked)}
              className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50 cursor-pointer"
            >
              이 순서로 요약하기
            </button>
          )}
          {stage === 'analyzing' && (
            <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer">
              닫기
            </button>
          )}
        </div>
      )}
    </>
  )
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div role="alert" className="mb-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
      <AlertTriangle size={15} className="mt-0.5 shrink-0" />
      <span>{message}</span>
    </div>
  )
}

/**
 * phase 'read' = ①(읽기). 분할 경로면 ①이 추출만 하고, 끝나면 'synthesize'(②)로 넘어간다.
 * 단일 호출 경로는 ①에서 바로 끝나므로 ② 문구를 보지 않는다.
 */
function AnalyzingView({ long, phase }: { long: boolean; phase: 'read' | 'synthesize' }) {
  const [step, setStep] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setStep((s) => (s + 1) % ANALYZE_STEPS.length), 4000)
    return () => clearInterval(t)
  }, [])
  return (
    <div data-phase={phase} className="flex flex-col items-center gap-3 py-10 text-center">
      <Loader2 size={28} className="animate-spin text-violet-500" />
      {phase === 'synthesize' ? (
        <>
          <p className="text-[11px] font-semibold text-violet-600 dark:text-violet-400">2/2단계 · 1단계(구간별 읽기) 완료</p>
          <p className="text-sm font-medium text-gray-800 dark:text-gray-200">읽은 내용을 종합해 노트를 정리하는 중…</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">1~2분 걸려요</p>
        </>
      ) : (
        <>
          <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{ANALYZE_STEPS[step]}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {long ? '긴 이미지라 구간별로 먼저 읽어요 (1/2단계, 1~2분)' : '30~90초 걸려요 · 긴 자료면 구간별로 읽은 뒤 종합해요'}
          </p>
        </>
      )}
    </div>
  )
}

// ── 이미지 순서 정리 ──

function ArrangeGrid({
  picked, setPicked, totalTiles,
}: {
  picked: PickedFile[]
  setPicked: (fn: (prev: PickedFile[]) => PickedFile[]) => void
  totalTiles: number
}) {
  const dragIndex = useRef<number | null>(null)

  const move = (from: number, to: number) => {
    if (to < 0 || to >= picked.length || from === to) return
    setPicked((prev) => {
      const next = prev.slice()
      const [it] = next.splice(from, 1)
      next.splice(to, 0, it)
      return next
    })
  }
  const remove = (i: number) => setPicked((prev) => {
    const target = prev[i]
    if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl)
    return prev.filter((_, j) => j !== i)
  })

  return (
    <div>
      <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
        순서대로 하나의 흐름으로 요약해요. 끌어서(또는 화살표로) 순서를 바꾸세요. · {picked.length}장 · 조각 {totalTiles}개
      </p>
      <ol className="grid grid-cols-3 gap-2.5 sm:grid-cols-4">
        {picked.map((p, i) => (
          <li
            key={p.key}
            draggable
            onDragStart={(e) => { dragIndex.current = i; e.dataTransfer.effectAllowed = 'move' }}
            onDragOver={(e) => { if (dragIndex.current !== null) e.preventDefault() }}
            onDrop={(e) => { e.preventDefault(); if (dragIndex.current !== null) move(dragIndex.current, i); dragIndex.current = null }}
            className="group relative overflow-hidden rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800"
          >
            <div className="aspect-[3/4] w-full overflow-hidden">
              {p.previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.previewUrl} alt={p.file.name} className="h-full w-full object-cover object-top" />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-1 px-2 text-center text-[10px] text-gray-500">
                  <ImageIcon size={18} />
                  긴 이미지<br />{p.width}×{p.height}
                </div>
              )}
            </div>
            <span className="absolute left-1.5 top-1.5 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white">{i + 1}</span>
            <button
              type="button"
              onClick={() => remove(i)}
              aria-label={`${p.file.name} 제외`}
              className="absolute right-1 top-1 rounded-md bg-black/60 p-1 text-white hover:bg-black/80 cursor-pointer"
            >
              <X size={11} />
            </button>
            <div className="flex items-center gap-1 border-t border-gray-200 px-1.5 py-1 dark:border-gray-700">
              <GripVertical size={11} className="hidden shrink-0 text-gray-400 sm:block" />
              <span className="min-w-0 flex-1 truncate text-[10px] text-gray-600 dark:text-gray-400" title={p.file.name}>{p.file.name}</span>
              <button type="button" onClick={() => move(i, i - 1)} disabled={i === 0} aria-label="앞으로" className="rounded p-0.5 text-gray-500 hover:bg-gray-200 disabled:opacity-30 dark:hover:bg-gray-700 cursor-pointer">
                <ArrowLeft size={11} />
              </button>
              <button type="button" onClick={() => move(i, i + 1)} disabled={i === picked.length - 1} aria-label="뒤로" className="rounded p-0.5 text-gray-500 hover:bg-gray-200 disabled:opacity-30 dark:hover:bg-gray-700 cursor-pointer">
                <ArrowRight size={11} />
              </button>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

// ── 검토 ──

interface FolderLite { id: string; name: string; parentId: string | null; orderIndex: number }

function ReviewView({
  response, uploaded, folders, defaultFolderId, creating, onReanalyze, onStartOver, onCreate,
}: {
  response: AnalyzeResponse
  uploaded: UploadedSource[]
  folders: FolderLite[]
  defaultFolderId: string | null
  creating: boolean
  onReanalyze: () => void
  onStartOver: () => void
  onCreate: (payload: { title: string; folderId: string | null; wikis: string[]; tags: string[]; includeRelated: boolean }) => void
}) {
  const a = response.analysis
  const [title, setTitle] = useState(a.title)
  const [folderId, setFolderId] = useState<string | null>(defaultFolderId)
  const [includeRelated, setIncludeRelated] = useState(true)
  const [expanded, setExpanded] = useState(false)
  const [confirmReanalyze, setConfirmReanalyze] = useState(false)
  const [wikis, setWikis] = useState<ChipState[]>(() => toChips(a.wikiSuggestions, 'w'))
  const [tags, setTags] = useState<ChipState[]>(() => toChips(a.tagSuggestions, 't'))

  // 다시 분석으로 결과가 바뀌면 편집 상태 초기화
  const lastId = useRef(response.analysisId + response.createdAt)
  useEffect(() => {
    const id = response.analysisId + response.createdAt
    if (lastId.current === id) return
    lastId.current = id
    setTitle(response.analysis.title)
    setWikis(toChips(response.analysis.wikiSuggestions, 'w'))
    setTags(toChips(response.analysis.tagSuggestions, 't'))
  }, [response])

  const sharedElsewhere = uploaded.filter((u) => u.linkedMemos.length > 0)
  const folderOptions = useMemo(() => flattenFolders(folders), [folders])

  return (
    <div className="space-y-4">
      {a.textAmount === 'low' && (
        <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          글자가 거의 없는 이미지예요 — 요약 품질이 낮을 수 있어요.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400">
        {response.meta.kind === 'pdf' ? <FileText size={12} /> : <ImageIcon size={12} />}
        <span>
          {response.meta.kind === 'pdf'
            ? `${response.meta.fileNames[0]}${response.meta.pageCount ? ` · ${response.meta.pageCount}쪽` : ''}`
            : `이미지 ${response.meta.imageCount}장`}
          {response.cached && ' · 저장된 분석 결과'}
        </span>
        {sharedElsewhere.length > 0 && (
          <span
            title={sharedElsewhere.map((u) => `${u.fileName}: ${u.linkedMemos.map((m) => m.title).join(', ')}`).join('\n')}
            className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-600 dark:bg-gray-800 dark:text-gray-300"
          >
            다른 노트에도 쓰임 {sharedElsewhere.length}개
          </span>
        )}
      </div>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-gray-600 dark:text-gray-400">제목</span>
        <input
          type="search"
          autoComplete="off"
          data-form-type="other"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-500/30 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
        />
      </label>

      <div className="rounded-lg border border-gray-200 bg-gray-50/70 p-3 dark:border-gray-700 dark:bg-gray-800/40">
        <p className="text-sm text-gray-800 dark:text-gray-200">{a.oneLiner}</p>
        {a.keyPoints.length > 0 && (
          <>
            {expanded && (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-gray-700 dark:text-gray-300">
                {a.keyPoints.map((k, i) => <li key={i}>{k}</li>)}
              </ul>
            )}
            <button type="button" onClick={() => setExpanded((v) => !v)} className="mt-1.5 text-xs font-medium text-violet-600 hover:underline dark:text-violet-400 cursor-pointer">
              {expanded ? '핵심 요약 접기' : `핵심 요약 ${a.keyPoints.length}개 보기`}
            </button>
          </>
        )}
      </div>

      <ChipGroup label="위키 (개념)" kind="wiki" chips={wikis} setChips={setWikis} />
      <ChipGroup label="태그 (분류)" kind="tag" chips={tags} setChips={setTags} />

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
          폴더
          <select
            value={folderId ?? ''}
            onChange={(e) => setFolderId(e.target.value || null)}
            className="rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-xs text-gray-800 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
          >
            <option value="">미분류</option>
            {folderOptions.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-400">
          <input type="checkbox" checked={includeRelated} onChange={(e) => setIncludeRelated(e.target.checked)} className="accent-violet-600" />
          연결된 메모 섹션 넣기{response.related.length ? ` (${response.related.length}개)` : ' (없음)'}
        </label>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-gray-200 pt-3 dark:border-gray-800">
        {confirmReanalyze ? (
          <span className="mr-auto flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
            오늘 요약 한도가 1회 차감돼요.
            <button type="button" onClick={() => { setConfirmReanalyze(false); onReanalyze() }} className="font-medium text-violet-600 hover:underline dark:text-violet-400 cursor-pointer">다시 분석</button>
            <button type="button" onClick={() => setConfirmReanalyze(false)} className="hover:underline cursor-pointer">취소</button>
          </span>
        ) : (
          <button type="button" onClick={() => setConfirmReanalyze(true)} disabled={creating} className="mr-auto inline-flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 disabled:opacity-50 dark:text-gray-400 dark:hover:text-gray-200 cursor-pointer">
            <RefreshCw size={12} /> 다시 분석
          </button>
        )}
        <button type="button" onClick={onStartOver} disabled={creating} className="text-xs text-gray-500 hover:text-gray-700 disabled:opacity-50 dark:text-gray-400 dark:hover:text-gray-200 cursor-pointer">
          다른 파일로
        </button>
        <button
          type="button"
          disabled={creating || !title.trim()}
          onClick={() => onCreate({
            title: title.trim(),
            folderId,
            wikis: wikis.filter((c) => c.selected).map((c) => c.name),
            tags: tags.filter((c) => c.selected).map((c) => c.name),
            includeRelated,
          })}
          className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50 cursor-pointer"
        >
          {creating ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          노트 만들기
        </button>
      </div>
    </div>
  )
}

function toChips(list: NoteSuggestion[], prefix: string): ChipState[] {
  // 이웃 추천·개념 출신 새 위키는 기본 해제 — 사용자가 고르게 (모델이 확신한 기존/새 위키만 기본 선택)
  return list.map((s, i) => ({ ...s, id: `${prefix}${i}-${s.name}`, selected: s.source !== 'neighbor' && !s.fromConcept }))
}

function flattenFolders(folders: FolderLite[]): { id: string; label: string }[] {
  const byParent = new Map<string | null, FolderLite[]>()
  for (const f of folders) {
    const arr = byParent.get(f.parentId ?? null) ?? []
    arr.push(f)
    byParent.set(f.parentId ?? null, arr)
  }
  const out: { id: string; label: string }[] = []
  const walk = (parent: string | null, depth: number) => {
    for (const f of (byParent.get(parent) ?? []).sort((x, y) => x.orderIndex - y.orderIndex)) {
      out.push({ id: f.id, label: `${'  '.repeat(depth)}${depth ? '└ ' : ''}${f.name}` })
      if (depth < 4) walk(f.id, depth + 1)
    }
  }
  walk(null, 0)
  return out
}

const CHIP_STYLE: Record<NoteSuggestion['source'], { on: string; dot: string; label: string }> = {
  existing: { on: 'border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-200', dot: 'bg-blue-500', label: '기존' },
  new: { on: 'border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-800 dark:bg-violet-950/40 dark:text-violet-200', dot: 'bg-violet-500', label: '새로 만듦' },
  neighbor: { on: 'border-cyan-300 bg-cyan-50 text-cyan-800 dark:border-cyan-800 dark:bg-cyan-950/40 dark:text-cyan-200', dot: 'bg-cyan-400', label: '비슷한 메모' },
}

function ChipGroup({
  label, kind, chips, setChips,
}: {
  label: string
  kind: 'wiki' | 'tag'
  chips: ChipState[]
  setChips: (fn: (prev: ChipState[]) => ChipState[]) => void
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [adding, setAdding] = useState(false)
  const [addValue, setAddValue] = useState('')
  const [focusReason, setFocusReason] = useState<string | null>(null)
  const addRef = useRef<HTMLInputElement>(null)
  const [addPos, setAddPos] = useState<{ x: number; y: number } | null>(null)
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressed = useRef(false)

  const keyFn = kind === 'wiki' ? wikiKey : tagKey
  const clean = (v: string) => (kind === 'wiki'
    ? v.replace(/[[\]]/g, '').replace(/\s+/g, '').trim()
    : v.replace(/^#+/, '').replace(/[^\w가-힣]/g, ''))

  const startEdit = (c: ChipState) => { setEditing(c.id); setEditValue(c.name) }
  const commitEdit = () => {
    const v = clean(editValue)
    if (editing && v) {
      setChips((prev) => {
        // 이름을 바꾼 결과가 다른 칩과 같은 키면 합친다
        const dupe = prev.find((c) => c.id !== editing && keyFn(c.name) === keyFn(v))
        if (dupe) return prev.filter((c) => c.id !== editing).map((c) => (c.id === dupe.id ? { ...c, selected: true } : c))
        return prev.map((c) => (c.id === editing ? { ...c, name: v, selected: true } : c))
      })
    }
    setEditing(null)
  }
  const addChip = (raw: string) => {
    const v = clean(raw)
    setAdding(false)
    setAddValue('')
    if (!v) return
    setChips((prev) => {
      const same = prev.find((c) => keyFn(c.name) === keyFn(v))
      if (same) return prev.map((c) => (c.id === same.id ? { ...c, selected: true } : c))
      return [...prev, { id: `add-${Date.now()}`, name: v, source: 'new', reason: '직접 추가', selected: true }]
    })
  }

  useEffect(() => {
    if (!adding) return
    const el = addRef.current
    if (!el) return
    el.focus()
    const r = el.getBoundingClientRect()
    // Suggest 컴포넌트는 top = y + 20에 그린다 — 입력창 바로 아래로
    setAddPos({ x: r.left, y: r.bottom - 16 })
  }, [adding])

  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-xs font-medium text-gray-600 dark:text-gray-400">{label}</span>
        <span className="text-[10px] text-gray-400">탭=선택 · 길게/우클릭=이름 수정</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {chips.map((c) => {
          const style = CHIP_STYLE[c.source]
          if (editing === c.id) {
            return (
              <input
                key={c.id}
                autoFocus
                type="search"
                autoComplete="off"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={commitEdit}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitEdit() } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setEditing(null) } }}
                data-escape-layer
                className="w-32 rounded-full border border-violet-400 bg-white px-2.5 py-1 text-xs focus:outline-none dark:bg-gray-800 dark:text-gray-100"
              />
            )
          }
          return (
            <button
              key={c.id}
              type="button"
              title={c.reason || style.label}
              onClick={() => {
                if (longPressed.current) { longPressed.current = false; return }
                setChips((prev) => prev.map((x) => (x.id === c.id ? { ...x, selected: !x.selected } : x)))
                setFocusReason(c.reason ? `${kind === 'wiki' ? `[[${c.name}]]` : `#${c.name}`} — ${c.reason}` : null)
              }}
              onContextMenu={(e) => { e.preventDefault(); startEdit(c) }}
              onPointerDown={(e) => {
                if (e.pointerType !== 'touch') return
                longPressed.current = false
                pressTimer.current = setTimeout(() => { longPressed.current = true; startEdit(c) }, 500)
              }}
              onPointerUp={() => { if (pressTimer.current) clearTimeout(pressTimer.current) }}
              onPointerLeave={() => { if (pressTimer.current) clearTimeout(pressTimer.current) }}
              className={cn(
                'inline-flex select-none items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors cursor-pointer',
                c.selected ? style.on : 'border-gray-200 bg-white text-gray-400 line-through dark:border-gray-700 dark:bg-gray-900 dark:text-gray-500',
              )}
            >
              <span className={cn('h-1.5 w-1.5 rounded-full', c.selected ? style.dot : 'bg-gray-300 dark:bg-gray-600')} />
              {kind === 'tag' ? '#' : ''}{c.name}
              {c.source === 'neighbor' && c.neighborCount ? <span className="opacity-70">· {c.neighborCount}</span> : null}
            </button>
          )
        })}
        {adding ? (
          <div data-escape-layer className="relative">
            <input
              ref={addRef}
              type="search"
              autoComplete="off"
              data-form-type="other"
              value={addValue}
              placeholder={kind === 'wiki' ? '위키 이름' : '태그 이름'}
              onChange={(e) => setAddValue(e.target.value)}
              onBlur={() => setTimeout(() => setAdding(false), 150)}
              className="w-32 rounded-full border border-violet-400 bg-white px-2.5 py-1 text-xs focus:outline-none dark:bg-gray-800 dark:text-gray-100"
            />
            {addPos && (kind === 'wiki'
              ? <WikiSuggest query={addValue} position={addPos} onSelect={addChip} onClose={() => setAdding(false)} />
              : <TagSuggest query={addValue} position={addPos} onSelect={addChip} onClose={() => setAdding(false)} />)}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-gray-300 px-2.5 py-1 text-xs text-gray-500 hover:border-violet-400 hover:text-violet-600 dark:border-gray-600 dark:text-gray-400 cursor-pointer"
          >
            <Plus size={11} /> 추가
          </button>
        )}
      </div>
      {focusReason && <p className="mt-1.5 text-[11px] text-gray-500 dark:text-gray-400">{focusReason}</p>}
      <div className="mt-1.5 flex flex-wrap gap-3 text-[10px] text-gray-400">
        {(['existing', 'new', 'neighbor'] as const).filter((s) => chips.some((c) => c.source === s)).map((s) => (
          <span key={s} className="inline-flex items-center gap-1"><span className={cn('h-1.5 w-1.5 rounded-full', CHIP_STYLE[s].dot)} />{CHIP_STYLE[s].label}</span>
        ))}
      </div>
    </div>
  )
}
