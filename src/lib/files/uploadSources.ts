'use client'

/**
 * 소스 파일 업로드 — 브라우저 → R2 직접 PUT
 *
 * 흐름: SHA-256 계산 → /api/files/presign(일괄) → R2 PUT(XHR, 진행률, 동시 3개)
 *       → /api/files/complete(파일별)
 *
 * 서버를 거치지 않으므로 Vercel 4.5MB 본문 제한과 무관하다.
 * 결과 배열은 **입력 순서를 유지**한다 (이미지 묶음의 순서가 곧 요약 흐름이므로).
 */

export interface LinkedMemoRef {
  id: string
  title: string
  inTrash: boolean
}

export interface UploadedSource {
  fileId: string
  deduplicated: boolean
  linkedMemos: LinkedMemoRef[]
  thumbnailUrl?: string | null
  width?: number | null
  height?: number | null
  fileName: string
  size: number
  mimeType: string
}

export interface UploadSourcesOptions {
  onProgress?: (overallPct: number, perFile: number[]) => void
  signal?: AbortSignal
}

const CONCURRENCY = 3

export async function uploadSources(
  files: File[],
  opts: UploadSourcesOptions = {},
): Promise<UploadedSource[]> {
  if (files.length === 0) return []
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('오프라인에서는 파일을 올릴 수 없어요.')
  }

  const hashes = await Promise.all(files.map(sha256Hex))

  const presignRes = await fetch('/api/files/presign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      files: files.map((f, i) => ({
        fileName: f.name,
        size: f.size,
        mimeType: f.type,
        contentHash: hashes[i],
      })),
    }),
    signal: opts.signal,
  })

  const presign = await presignRes.json().catch(() => ({}))
  if (!presignRes.ok) {
    throw new Error(presign?.error || '업로드 준비에 실패했어요.')
  }

  type PresignEntry =
    | { deduplicated: true; fileId: string; url: string; thumbnailUrl: string | null; width: number | null; height: number | null; pageCount: number | null; linkedMemos: LinkedMemoRef[] }
    | { deduplicated: false; key: string; uploadUrl: string }
  const entries: PresignEntry[] = presign.files ?? []
  if (entries.length !== files.length) {
    throw new Error('업로드 준비 응답이 올바르지 않아요.')
  }

  // 진행률: 이미 올라가 있는 파일(dedupe)은 100%로 시작
  const perFile: number[] = entries.map((e) => (e.deduplicated ? 100 : 0))
  const totalBytes = files.reduce((s, f) => s + f.size, 0) || 1
  const emit = () => {
    if (!opts.onProgress) return
    const done = files.reduce((s, f, i) => s + (f.size * perFile[i]) / 100, 0)
    opts.onProgress(Math.round((done / totalBytes) * 100), [...perFile])
  }
  emit()

  const results: (UploadedSource | null)[] = entries.map((e, i) =>
    e.deduplicated
      ? {
          fileId: e.fileId,
          deduplicated: true,
          linkedMemos: e.linkedMemos ?? [],
          thumbnailUrl: e.thumbnailUrl,
          width: e.width,
          height: e.height,
          fileName: files[i].name,
          size: files[i].size,
          mimeType: files[i].type,
        }
      : null,
  )

  // 신규 업로드만 동시 3개로 처리
  const pending = entries
    .map((e, i) => ({ e, i }))
    .filter((x): x is { e: Extract<PresignEntry, { deduplicated: false }>; i: number } => !x.e.deduplicated)

  let cursor = 0
  async function worker() {
    for (;;) {
      const next = cursor++
      if (next >= pending.length) return
      const { e, i } = pending[next]
      const file = files[i]

      await xhrPut(e.uploadUrl, file, opts.signal, (pct) => {
        perFile[i] = pct
        emit()
      })

      const completeRes = await fetch('/api/files/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: e.key,
          fileName: file.name,
          size: file.size,
          mimeType: file.type,
          contentHash: hashes[i],
        }),
        signal: opts.signal,
      })
      const completed = await completeRes.json().catch(() => ({}))
      if (!completeRes.ok) throw new Error(completed?.error || `${file.name} 업로드 확정에 실패했어요.`)

      results[i] = {
        fileId: completed.fileId,
        deduplicated: !!completed.deduplicated,
        linkedMemos: [],
        thumbnailUrl: completed.thumbnailUrl ?? null,
        width: completed.width ?? null,
        height: completed.height ?? null,
        fileName: file.name,
        size: file.size,
        mimeType: file.type,
      }
      perFile[i] = 100
      emit()
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pending.length) }, worker))

  return results.map((r, i) => {
    if (!r) throw new Error(`${files[i].name} 업로드 결과가 비었어요.`)
    return r
  })
}

/** 파일 SHA-256 (hex) — 서버 멱등 키 */
async function sha256Hex(file: File): Promise<string> {
  const buf = await file.arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * XHR PUT — fetch 대신 쓰는 이유는 업로드 진행률(upload.onprogress) 때문.
 * Content-Type은 presign 서명과 정확히 일치해야 한다.
 */
function xhrPut(
  url: string,
  file: File,
  signal: AbortSignal | undefined,
  onPct: (pct: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url, true)
    xhr.setRequestHeader('Content-Type', file.type)

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) onPct(Math.round((ev.loaded / ev.total) * 100))
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve()
      else reject(new Error(`${file.name} 업로드 실패 (${xhr.status})`))
    }
    xhr.onerror = () => reject(new Error(`${file.name} 업로드 중 네트워크 오류가 났어요.`))
    xhr.onabort = () => reject(new DOMException('업로드를 취소했어요.', 'AbortError'))

    if (signal) {
      if (signal.aborted) { xhr.abort(); return }
      signal.addEventListener('abort', () => xhr.abort(), { once: true })
    }
    xhr.send(file)
  })
}
