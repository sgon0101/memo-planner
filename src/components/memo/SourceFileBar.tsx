'use client'

/**
 * 원본 소스 파일 카드 — 노트에 묶인 PDF 1개 또는 이미지 N장을 보여주고 원본을 받게 한다.
 *
 * ⚠️ 본문 링크로 만들지 않는 이유: 에디터 Link 확장이 `openOnClick: false`라
 *    본문에 넣은 링크는 클릭해도 열리지 않는다. 그래서 별도 카드로 뺐다.
 *
 * 열기/다운로드는 모두 `/api/files/[id]/download`(같은 출처)를 거친다 —
 * R2 공개 URL은 다른 출처(r2.dev)라 `<a download>`이 무시되고 파일명이 UUID로 떨어진다.
 */

import { useEffect, useState } from 'react'
import { Download, ExternalLink, FileText, FolderDown, Image as ImageIcon, Loader2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useOnlineStatus } from '@/hooks/useOnlineStatus'
import { formatBytes } from '@/lib/files/sourceLimits'
import { toast } from '@/components/ui/Toast'
import { cn } from '@/lib/utils'

interface SourceFile {
  id: string
  fileName: string
  mimeType: string
  size: number
  thumbnailUrl: string | null
  pageCount: number | null
  imageHeight: number | null
  position: number
}

/**
 * 이 세로 길이 이상이면 브라우저 새 탭 보기가 느리거나(모바일은 디코딩 실패·잘림) 사실상 못 본다 —
 * 원본 보기 대신 다운로드를 권한다.
 */
const TALL_IMAGE_PX = 20_000

interface Props {
  memoId: string | null
  /** 노트 제목 — zip 파일명에 사용 */
  memoTitle?: string
}

export default function SourceFileBar({ memoId, memoTitle }: Props) {
  const supabase = createClient()
  const online = useOnlineStatus()
  const [files, setFiles] = useState<SourceFile[] | null>(null)
  const [zipping, setZipping] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      if (!memoId) { if (alive) setFiles(null); return }
      const { data } = await supabase
        .from('memo_sources')
        .select('position, uploaded_files!inner(id, file_name, mime_type, compressed_size, thumbnail_url, page_count, image_height)')
        .eq('memo_id', memoId)
        .order('position', { ascending: true })
      if (!alive) return
      const rows = (data ?? []).map((r) => {
        const f = (r as unknown as { uploaded_files: Record<string, unknown> }).uploaded_files
        return {
          id: f.id as string,
          fileName: (f.file_name as string) ?? '파일',
          mimeType: (f.mime_type as string) ?? '',
          size: (f.compressed_size as number) ?? 0,
          thumbnailUrl: (f.thumbnail_url as string | null) ?? null,
          pageCount: (f.page_count as number | null) ?? null,
          imageHeight: (f.image_height as number | null) ?? null,
          position: (r as unknown as { position: number }).position ?? 0,
        }
      })
      setFiles(rows)
    })()
    return () => { alive = false }
  }, [memoId, supabase])

  // 소스가 없으면 아무것도 렌더하지 않는다 (로딩 중에도 — 레이아웃 시프트 방지)
  if (!files || files.length === 0) return null

  const isPdf = files.length === 1 && files[0].mimeType === 'application/pdf'
  const isTall = (f: SourceFile) => (f.imageHeight ?? 0) >= TALL_IMAGE_PX
  const hasTall = files.some(isTall)
  const totalSize = files.reduce((s, f) => s + f.size, 0)

  function openFile(id: string) {
    window.open(`/api/files/${id}/download?mode=inline`, '_blank', 'noopener')
  }

  function downloadFile(id: string) {
    // 같은 출처 <a> click — Android PWA에서 알림바 다운로드로 잡힌다
    const a = document.createElement('a')
    a.href = `/api/files/${id}/download?mode=attachment`
    a.rel = 'noopener'
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  async function downloadAllAsZip() {
    if (!files || zipping) return
    setZipping(true)
    try {
      const { zipSync } = await import('fflate')
      const entries: Record<string, Uint8Array> = {}
      const used = new Set<string>()

      for (let i = 0; i < files.length; i++) {
        const f = files[i]
        const res = await fetch(`/api/files/${f.id}/download?mode=inline`)
        if (!res.ok) throw new Error(`${f.fileName} 받기 실패`)
        const buf = new Uint8Array(await res.arrayBuffer())
        // 순서 접두사 + 파일명 충돌 시 (2), (3)…
        let name = `${String(i + 1).padStart(2, '0')}_${f.fileName}`
        if (used.has(name)) {
          const dot = name.lastIndexOf('.')
          const base = dot > 0 ? name.slice(0, dot) : name
          const ext = dot > 0 ? name.slice(dot) : ''
          let n = 2
          while (used.has(`${base}(${n})${ext}`)) n++
          name = `${base}(${n})${ext}`
        }
        used.add(name)
        entries[name] = buf
      }

      const zipped = zipSync(entries, { level: 0 }) // 이미 압축된 포맷이라 저장만
      const blob = new Blob([zipped as unknown as BlobPart], { type: 'application/zip' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${(memoTitle || '노트').replace(/[\\/:*?"<>|]/g, '_')}_원본.zip`
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10_000)
    } catch (e) {
      // 외부 작업 실패 — 화면에 흔적이 안 남으므로 토스트로 알린다
      toast.error(e instanceof Error ? e.message : '원본을 받지 못했어요.')
    } finally {
      setZipping(false)
    }
  }

  return (
    <div className="px-5 md:px-8 pb-2">
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50/70 dark:bg-gray-800/40 px-3 py-2.5">
        {isPdf ? (
          <div className="flex items-center gap-2.5">
            <FileText size={16} className="shrink-0 text-violet-500" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-gray-800 dark:text-gray-200">{files[0].fileName}</div>
              <div className="text-[11px] text-gray-500 dark:text-gray-400">
                {files[0].pageCount ? `${files[0].pageCount}쪽 · ` : ''}{formatBytes(files[0].size)}
              </div>
            </div>
            <ActionButton icon={ExternalLink} label="열기" disabled={!online} onClick={() => openFile(files[0].id)} />
            <ActionButton icon={Download} label="다운로드" disabled={!online} onClick={() => downloadFile(files[0].id)} />
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2.5 mb-2">
              <ImageIcon size={16} className="shrink-0 text-violet-500" />
              <div className="min-w-0 flex-1 text-[11px] text-gray-500 dark:text-gray-400">
                이미지 {files.length}장 · 합계 {formatBytes(totalSize)}
              </div>
              {files.length >= 2 && (
                <button
                  type="button"
                  onClick={downloadAllAsZip}
                  disabled={!online || zipping}
                  title={online ? '원본 전체를 zip으로 받기' : '오프라인에서는 받을 수 없어요'}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors cursor-pointer',
                    'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300',
                    'hover:bg-gray-100 dark:hover:bg-gray-700',
                    (!online || zipping) && 'opacity-50 cursor-not-allowed',
                  )}
                >
                  {zipping ? <Loader2 size={12} className="animate-spin" /> : <FolderDown size={12} />}
                  전체 받기
                </button>
              )}
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {files.map((f, i) => (
                <div key={f.id} className="group relative shrink-0">
                  <button
                    type="button"
                    onClick={() => (isTall(f) ? downloadFile(f.id) : openFile(f.id))}
                    disabled={!online}
                    title={isTall(f)
                      ? `${f.fileName} — 세로 ${f.imageHeight?.toLocaleString()}px 긴 이미지라 다운로드해서 보는 걸 권해요`
                      : `${f.fileName} — 원본 보기`}
                    className="block h-20 w-20 overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 cursor-pointer disabled:cursor-not-allowed"
                  >
                    {f.thumbnailUrl ? (
                      // 세로로 긴 이미지는 상단 크롭 썸네일이라 object-top
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={f.thumbnailUrl} alt={f.fileName} className="h-full w-full object-cover object-top" />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center text-[10px] text-gray-400">
                        {i + 1}
                      </span>
                    )}
                  </button>
                  {isTall(f) && (
                    <span className="pointer-events-none absolute left-1 top-1 rounded bg-black/60 px-1 text-[9px] font-medium text-white">긴 이미지</span>
                  )}
                  <button
                    type="button"
                    onClick={() => downloadFile(f.id)}
                    disabled={!online}
                    title={`${f.fileName} 다운로드`}
                    className="absolute bottom-1 right-1 rounded-md bg-black/60 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 cursor-pointer disabled:cursor-not-allowed"
                  >
                    <Download size={11} />
                  </button>
                </div>
              ))}
            </div>
            {hasTall && (
              <p className="mt-1.5 text-[11px] text-gray-500 dark:text-gray-400">
                세로 2만px 이상인 긴 이미지는 브라우저에서 열면 느리거나 잘릴 수 있어요 — 탭하면 다운로드돼요. 기기의 사진 앱에서 보세요.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function ActionButton({
  icon: Icon, label, onClick, disabled,
}: {
  icon: typeof Download
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? '오프라인에서는 사용할 수 없어요' : label}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors cursor-pointer',
        'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300',
        'hover:bg-gray-100 dark:hover:bg-gray-700',
        disabled && 'opacity-50 cursor-not-allowed',
      )}
    >
      <Icon size={12} />
      {label}
    </button>
  )
}
