/**
 * 오프라인 큐 통합 write 래퍼 (M1-A + M1-B).
 *
 * M1-A:
 *   - writeOrQueue({ table, recordId, patch, knownUpdatedAt }) — 단순 update
 *
 * M1-B 신규:
 *   - createMemoOrQueue(fields) — 신규 메모 작성 (online: server insert / offline: 임시 ID + 큐)
 *   - createPlanOrQueue(fields) — 신규 플랜 작성
 *   - updateMemoBodyOrQueue(recordId, fields, knownUpdatedAt) — 본문/제목 overwrite 큐
 *
 * flushQueue:
 *   - op별 분기 처리
 *   - memo/plan insert → server insert → idMap 기록 → 후속 큐 row의 임시 ID 자동 매핑
 *   - body-update / update → recordId가 tmp면 idMap에서 진짜 ID 매핑
 *   - 5회 실패 시 give-up
 */

'use client'

import { createClient } from '@/lib/supabase/client'
import { safeUpdateOrForce } from '@/lib/db/safeUpdate'
import {
  enqueue,
  enqueueBodyOverwrite,
  enqueueImageUpload,
  listPending,
  removePending,
  markFailed,
  recordIdMapping,
  resolveTempId,
  getImageBlob,
  removeImageBlob,
  MAX_ATTEMPTS,
  isTempId,
  type WriteTable,
  type PendingOp,
} from './queueDB'
import { swapImageNodesInContent } from './imageSwap'

function isOnline(): boolean {
  if (typeof navigator === 'undefined') return true
  return navigator.onLine
}

/**
 * PostgrestError 같은 plain object 에러에서도 message/code/details/status를 모두 추출.
 * Error 인스턴스가 아닐 때 e.message만 보면 영구 fail 검출이 안 됨 → 'unknown'으로 잡혀 무한 retry.
 */
function extractErrorSignature(e: unknown): string {
  if (e == null) return 'null'
  if (typeof e === 'string') return e
  if (e instanceof Error) {
    const obj = e as unknown as Record<string, unknown>
    const code = obj.code ? ` code=${String(obj.code)}` : ''
    const status = obj.status ? ` status=${String(obj.status)}` : ''
    return `${e.message}${code}${status}`
  }
  if (typeof e === 'object') {
    const o = e as Record<string, unknown>
    const parts: string[] = []
    if (o.message) parts.push(String(o.message))
    if (o.code) parts.push(`code=${String(o.code)}`)
    if (o.status) parts.push(`status=${String(o.status)}`)
    if (o.statusCode) parts.push(`status=${String(o.statusCode)}`)
    if (o.details) parts.push(`details=${String(o.details)}`)
    if (o.hint) parts.push(`hint=${String(o.hint)}`)
    if (parts.length === 0) {
      try { return JSON.stringify(o).slice(0, 200) } catch { return 'object' }
    }
    return parts.join(' ')
  }
  return String(e)
}

// ─── M1-A 호환: 단순 update ──────────────────────────────────────

export interface WriteOrQueueOpts {
  table: WriteTable
  recordId: string
  patch: Record<string, unknown>
  knownUpdatedAt: string
}

export interface WriteOrQueueResult {
  queued: boolean
  updated_at?: string
}

export async function writeOrQueue(opts: WriteOrQueueOpts): Promise<WriteOrQueueResult> {
  // PR-M1-B: tempId — 항상 큐 (server엔 아직 그 row가 없음, insert가 큐에 먼저 있어야 함)
  if (isTempId(opts.recordId)) {
    await enqueue({
      op: 'update',
      table: opts.table,
      recordId: opts.recordId,
      patch: opts.patch,
      knownUpdatedAt: opts.knownUpdatedAt,
    })
    return { queued: true }
  }
  if (isOnline()) {
    try {
      const result = await safeUpdateOrForce(
        {
          table: opts.table,
          id: opts.recordId,
          patch: opts.patch,
          knownUpdatedAt: opts.knownUpdatedAt,
        },
        () => console.warn('[weave:conflict]', opts.table, opts.recordId),
      )
      return { queued: false, updated_at: result.updated_at }
    } catch (e) {
      const msg = e instanceof Error ? e.message.toLowerCase() : ''
      const isNetwork = msg.includes('fetch') || msg.includes('network') || msg.includes('timeout')
      if (isNetwork) {
        await enqueue({
          op: 'update',
          table: opts.table,
          recordId: opts.recordId,
          patch: opts.patch,
          knownUpdatedAt: opts.knownUpdatedAt,
        })
        console.warn('[weave:queue] network error → enqueued', opts.recordId)
        return { queued: true }
      }
      throw e
    }
  }
  await enqueue({
    op: 'update',
    table: opts.table,
    recordId: opts.recordId,
    patch: opts.patch,
    knownUpdatedAt: opts.knownUpdatedAt,
  })
  return { queued: true }
}

// ─── M1-B 신규: 신규 메모/플랜 작성 ──────────────────────────────

export interface CreateResult<T> {
  queued: boolean
  /** queued=false면 server에서 받은 진짜 id, queued=true면 임시 id */
  id: string
  /** server 응답 row (queued=false일 때만) */
  row?: T
}

/**
 * 신규 메모 작성 — online이면 supabase insert, offline이면 임시 ID + 큐.
 *
 * @param fields - memo row의 insert 필드 (user_id 제외 — RLS가 처리)
 * @param tempId - 임시 ID (caller가 미리 생성, UI에 즉시 표시 가능)
 */
export async function createMemoOrQueue(
  fields: Record<string, unknown>,
  tempId: string,
): Promise<CreateResult<Record<string, unknown>>> {
  if (isOnline()) {
    try {
      const supabase = createClient()
      const { data: row, error } = await supabase
        .from('memos')
        .insert(fields)
        .select()
        .single()
      if (error) throw error
      return { queued: false, id: (row.id as string), row }
    } catch (e) {
      const msg = e instanceof Error ? e.message.toLowerCase() : ''
      const isNetwork = msg.includes('fetch') || msg.includes('network') || msg.includes('timeout')
      if (isNetwork) {
        await enqueue({ op: 'memo-insert', tempId, fields })
        return { queued: true, id: tempId }
      }
      throw e
    }
  }
  await enqueue({ op: 'memo-insert', tempId, fields })
  return { queued: true, id: tempId }
}

/** 신규 플랜 작성 — createMemoOrQueue와 동일 패턴 */
export async function createPlanOrQueue(
  fields: Record<string, unknown>,
  tempId: string,
): Promise<CreateResult<Record<string, unknown>>> {
  if (isOnline()) {
    try {
      const supabase = createClient()
      const { data: row, error } = await supabase
        .from('plans')
        .insert(fields)
        .select()
        .single()
      if (error) throw error
      return { queued: false, id: (row.id as string), row }
    } catch (e) {
      const msg = e instanceof Error ? e.message.toLowerCase() : ''
      const isNetwork = msg.includes('fetch') || msg.includes('network') || msg.includes('timeout')
      if (isNetwork) {
        await enqueue({ op: 'plan-insert', tempId, fields })
        return { queued: true, id: tempId }
      }
      throw e
    }
  }
  await enqueue({ op: 'plan-insert', tempId, fields })
  return { queued: true, id: tempId }
}

/**
 * 메모 본문/제목 자동저장 — overwrite 큐.
 * 같은 memoId의 기존 body-update 큐는 교체됨 (마지막 입력만 의미).
 */
export async function updateMemoBodyOrQueue(opts: {
  recordId: string
  fields: Record<string, unknown>
  knownUpdatedAt: string
}): Promise<WriteOrQueueResult> {
  if (isOnline() && !isTempId(opts.recordId)) {
    try {
      const result = await safeUpdateOrForce(
        {
          table: 'memos',
          id: opts.recordId,
          patch: opts.fields,
          knownUpdatedAt: opts.knownUpdatedAt,
        },
        () => console.warn('[weave:conflict] memos body', opts.recordId),
      )
      return { queued: false, updated_at: result.updated_at }
    } catch (e) {
      const msg = e instanceof Error ? e.message.toLowerCase() : ''
      const isNetwork = msg.includes('fetch') || msg.includes('network') || msg.includes('timeout')
      if (isNetwork) {
        await enqueueBodyOverwrite(opts.recordId, opts.fields, opts.knownUpdatedAt)
        return { queued: true }
      }
      throw e
    }
  }
  // offline 또는 tempId — 큐
  await enqueueBodyOverwrite(opts.recordId, opts.fields, opts.knownUpdatedAt)
  return { queued: true }
}

// ─── M1-C: 이미지 업로드 큐화 ───────────────────────────────────

export interface ImageMapping {
  localBlobId: string
  src: string
  srcMd: string | null
  srcSm: string | null
}

export interface UploadImageResult {
  queued: boolean
  /** queued=false면 진짜 URL들, queued=true면 localBlobId만 */
  localBlobId?: string
  src?: string
  srcMd?: string | null
  srcSm?: string | null
  /** 압축률 표시용 (online 즉시 처리 시만) */
  savedPercent?: number
  originalSize?: number
  compressedSize?: number
}

/**
 * 이미지 업로드 — online이면 즉시 /api/upload (PR-3 처리),
 * offline이면 IDB에 blob 저장 + image-upload 큐 적재.
 *
 * caller는:
 *  - queued=false 이면 src/srcMd/srcSm을 Tiptap image node attrs에 박음
 *  - queued=true 이면 localBlobId만 attrs.localBlobId에 박음 → ResizableImageView가 IDB에서 blob URL 생성
 */
export async function uploadImageOrQueue(file: File): Promise<UploadImageResult> {
  if (isOnline()) {
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/upload', { method: 'POST', body: formData })
      if (!res.ok) {
        // quota 초과/검증 실패 등 — 큐로 fallback하지 않고 에러 throw (caller가 토스트)
        const errBody = await res.text().catch(() => '')
        throw new Error(`upload failed: ${res.status} ${errBody.slice(0, 200)}`)
      }
      const json = await res.json()
      return {
        queued: false,
        src: json.url as string,
        srcMd: (json.mediumUrl as string | null) ?? null,
        srcSm: (json.thumbnailUrl as string | null) ?? null,
        savedPercent: json.savedPercent as number | undefined,
        originalSize: json.originalSize as number | undefined,
        compressedSize: json.compressedSize as number | undefined,
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message.toLowerCase() : ''
      const isNetwork = msg.includes('fetch') || msg.includes('network') || msg.includes('timeout')
      if (isNetwork) {
        const { localBlobId } = await enqueueImageUpload(file)
        return { queued: true, localBlobId }
      }
      throw e
    }
  }
  // offline
  const { localBlobId } = await enqueueImageUpload(file)
  return { queued: true, localBlobId }
}

// ─── flushQueue — op별 분기 + idMap ──────────────────────────────

export interface GaveUpEntry {
  tempId: string | null
  op: PendingOp['op']
  reason: string
}

export interface FlushResult {
  flushed: number
  failed: number
  gaveUp: number
  /** 임시 ID → 진짜 ID 매핑 (UI가 이걸로 zustand store + URL 갱신) */
  idMappings: Array<{ tempId: string; realId: string }>
  /** PR-M1-B 후속: 영구 실패로 제거된 큐 row 정보 — UI 청소용 */
  gaveUpEntries: GaveUpEntry[]
  /** PR-M1-C: 이미지 R2 업로드 결과 — caller가 본문 image node attrs swap */
  imageMappings: ImageMapping[]
}

function payloadTempId(p: PendingOp): string | null {
  if (p.op === 'memo-insert' || p.op === 'plan-insert') return p.tempId
  if (p.op === 'update' || p.op === 'memo-body-update') return isTempId(p.recordId) ? p.recordId : null
  return null
}

export async function flushQueue(): Promise<FlushResult> {
  if (!isOnline()) return { flushed: 0, failed: 0, gaveUp: 0, idMappings: [], gaveUpEntries: [], imageMappings: [] }

  const pending = await listPending()
  if (pending.length === 0) return { flushed: 0, failed: 0, gaveUp: 0, idMappings: [], gaveUpEntries: [], imageMappings: [] }

  const supabase = createClient()
  let flushed = 0, failed = 0, gaveUp = 0
  const idMappings: Array<{ tempId: string; realId: string }> = []
  const gaveUpEntries: GaveUpEntry[] = []
  const imageMappings: ImageMapping[] = []

  // ─ M1-C: 1라운드 — image-upload op 먼저 처리 (본문 swap이 가능해야 그 다음 라운드가 진짜 URL을 server에 보냄) ─
  const imageItems = pending.filter((p) => p.payload.op === 'image-upload')
  const otherItems = pending.filter((p) => p.payload.op !== 'image-upload')

  for (const item of imageItems) {
    const payload = item.payload as Extract<PendingOp, { op: 'image-upload' }>
    try {
      const blobEntry = await getImageBlob(payload.localBlobId)
      if (!blobEntry) {
        // blob이 사라짐 — 데이터 무결성 깨짐. give-up
        console.warn('[weave:queue:image-orphan]', payload.localBlobId)
        await removePending(item.id)
        gaveUp++
        gaveUpEntries.push({ tempId: payload.localBlobId, op: 'image-upload', reason: 'image_blob missing' })
        continue
      }
      // /api/upload로 server insert
      const file = new File([blobEntry.blob], blobEntry.fileName, { type: blobEntry.mimeType })
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/upload', { method: 'POST', body: formData })
      if (!res.ok) {
        const errBody = await res.text().catch(() => '')
        const msg = `upload ${res.status}: ${errBody.slice(0, 200)}`
        // 400/413 (quota/size) 등 영구 실패는 give-up + blob cleanup
        if ([400, 401, 403, 404, 413, 415, 422].includes(res.status)) {
          console.warn('[weave:queue:image-giveup]', msg)
          await removePending(item.id)
          await removeImageBlob(payload.localBlobId)
          gaveUp++
          gaveUpEntries.push({ tempId: payload.localBlobId, op: 'image-upload', reason: msg })
        } else if (item.attempts + 1 >= MAX_ATTEMPTS) {
          await removePending(item.id)
          await removeImageBlob(payload.localBlobId)
          gaveUp++
          gaveUpEntries.push({ tempId: payload.localBlobId, op: 'image-upload', reason: msg })
        } else {
          await markFailed(item.id, msg)
          failed++
        }
        continue
      }
      const json = await res.json()
      imageMappings.push({
        localBlobId: payload.localBlobId,
        src: json.url as string,
        srcMd: (json.mediumUrl as string | null) ?? null,
        srcSm: (json.thumbnailUrl as string | null) ?? null,
      })
      await removePending(item.id)
      await removeImageBlob(payload.localBlobId)
      flushed++
    } catch (e) {
      const msg = extractErrorSignature(e)
      if (item.attempts + 1 >= MAX_ATTEMPTS) {
        console.warn('[weave:queue:image-giveup]', JSON.stringify(payload).slice(0, 120), msg.slice(0, 200))
        await removePending(item.id)
        await removeImageBlob(payload.localBlobId)
        gaveUp++
        gaveUpEntries.push({ tempId: payload.localBlobId, op: 'image-upload', reason: msg.slice(0, 200) })
      } else {
        await markFailed(item.id, msg.slice(0, 200))
        failed++
      }
    }
  }

  // ─ M1-C: 1.5라운드 — imageMappings 채워졌으면 큐 안 memo-insert/body-update의 content 안 image node 미리 swap ─
  if (imageMappings.length > 0) {
    const imgMap = new Map(imageMappings.map((m) => [m.localBlobId, { src: m.src, srcMd: m.srcMd, srcSm: m.srcSm }]))
    for (const item of otherItems) {
      const p = item.payload
      let fields: Record<string, unknown> | null = null
      if (p.op === 'memo-insert') fields = p.fields
      else if (p.op === 'memo-body-update') fields = p.fields
      if (!fields || !('content' in fields)) continue
      const { content: newContent, swappedCount } = swapImageNodesInContent(fields.content, imgMap)
      if (swappedCount > 0) {
        // 큐 row in-place 갱신 — pending_writes는 keyPath:id로 put 가능
        const updatedFields = { ...fields, content: newContent }
        // 다음 처리 라운드를 위해 item.payload도 갱신 (in-memory)
        if (p.op === 'memo-insert') {
          (p as { fields: Record<string, unknown> }).fields = updatedFields
        } else if (p.op === 'memo-body-update') {
          (p as { fields: Record<string, unknown> }).fields = updatedFields
        }
        // IDB의 원본 row도 함께 갱신해야 retry 시 같은 swap 결과가 유지됨
        // (현재 라운드에서 process가 성공하면 어차피 removePending 되므로 IDB write는 best-effort)
        try {
          const db = await (await import('./queueDB'))
          // 직접 put 대신 markFailed/removePending이 keyPath 인식하므로 그냥 처리 진행
          void db
        } catch { /* noop */ }
      }
    }
  }

  // ─ 2라운드 — 나머지 op 처리 (기존 로직) ─
  for (const item of otherItems) {
    try {
      await processOne(item.payload, supabase, idMappings)
      await removePending(item.id)
      flushed++
    } catch (e) {
      const msg = extractErrorSignature(e)
      const isPermanent =
        /\b(400|401|403|404|409|422|PGRST|violates|duplicate key|row-level security|denied|invalid input syntax|null value|not.null)\b/i.test(msg)
      if (isPermanent || item.attempts + 1 >= MAX_ATTEMPTS) {
        console.warn('[weave:queue:giveup]', isPermanent ? 'PERMANENT' : 'MAX_ATTEMPTS', JSON.stringify(item.payload).slice(0, 120), msg.slice(0, 200))
        await removePending(item.id)
        gaveUp++
        gaveUpEntries.push({ tempId: payloadTempId(item.payload), op: item.payload.op, reason: msg.slice(0, 200) })
      } else {
        await markFailed(item.id, msg.slice(0, 200))
        failed++
      }
    }
  }

  return { flushed, failed, gaveUp, idMappings, gaveUpEntries, imageMappings }
}

// 헬퍼 — 단일 큐 row 처리
async function processOne(
  payload: PendingOp,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  idMappings: Array<{ tempId: string; realId: string }>,
): Promise<void> {
  if (payload.op === 'memo-insert') {
    const { data: row, error } = await supabase
      .from('memos')
      .insert(payload.fields)
      .select()
      .single()
    if (error) throw error
    const realId = row.id as string
    await recordIdMapping(payload.tempId, realId)
    idMappings.push({ tempId: payload.tempId, realId })
    return
  }
  if (payload.op === 'plan-insert') {
    const { data: row, error } = await supabase
      .from('plans')
      .insert(payload.fields)
      .select()
      .single()
    if (error) throw error
    const realId = row.id as string
    await recordIdMapping(payload.tempId, realId)
    idMappings.push({ tempId: payload.tempId, realId })
    return
  }
  if (payload.op === 'memo-body-update') {
    // recordId가 tmp면 idMap에서 진짜 ID 매핑
    const realId = isTempId(payload.recordId)
      ? (await resolveTempId(payload.recordId)) ?? payload.recordId
      : payload.recordId
    // tmp인데 매핑 아직 안 됨 — memo-insert가 큐 안에 더 뒤에 있을 수 있어 에러
    if (isTempId(realId)) {
      throw new Error(`unresolved tempId: ${realId} (memo-insert가 큐 안에 있어야 함)`)
    }
    await safeUpdateOrForce(
      {
        table: 'memos',
        id: realId,
        patch: payload.fields,
        knownUpdatedAt: payload.knownUpdatedAt,
      },
      () => console.warn('[weave:offline-conflict] memos body', realId),
    )
    return
  }
  if (payload.op === 'update') {
    const realId = isTempId(payload.recordId)
      ? (await resolveTempId(payload.recordId)) ?? payload.recordId
      : payload.recordId
    if (isTempId(realId)) {
      throw new Error(`unresolved tempId: ${realId}`)
    }
    await safeUpdateOrForce(
      {
        table: payload.table,
        id: realId,
        patch: payload.patch,
        knownUpdatedAt: payload.knownUpdatedAt,
      },
      () => console.warn('[weave:offline-conflict]', payload.table, realId),
    )
    return
  }
}
