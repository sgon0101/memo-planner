import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getDriveClient, createDriveFolder, uploadDriveFile } from '@/lib/google/drive'
import { buildMemoMarkdown, safeFilenameUnique } from '@/lib/export/toMarkdown'

// Next.js route segment config — import 뒤에 위치해야 인식됨
export const maxDuration = 300  // Pro: 최대 300s, Hobby: 10s로 자동 cap

const ROOT_FOLDER_ID = process.env.GOOGLE_DRIVE_BACKUP_FOLDER_ID || undefined

// ─── Tiptap JSON에서 이미지 URL 추출 ─────────────────────────
function extractImageUrls(content: Record<string, unknown>): string[] {
  const urls: string[] = []
  function traverse(node: Record<string, unknown>) {
    if (node.type === 'image' && node.attrs && typeof node.attrs === 'object') {
      const src = (node.attrs as Record<string, unknown>).src
      if (typeof src === 'string' && src) urls.push(src)
    }
    const children = node.content as Record<string, unknown>[] | undefined
    if (children) children.forEach(traverse)
  }
  traverse(content)
  return urls
}

// ─── 이미지 파일명 생성 ──────────────────────────────────────
function getImageFileName(url: string, memoTitle: string): string {
  const parts = url.split('/')
  const original = parts[parts.length - 1].split('?')[0]
  const ext = original.includes('.') ? original.split('.').pop() : 'webp'
  const uuid8 = original.replace(/\.[^.]+$/, '').slice(0, 8)
  const safeTitle = memoTitle
    .replace(/[<>:"/\\|?*\[\]'`]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 30)
    .replace(/_+$/, '') || 'memo'
  return `${safeTitle}_${uuid8}.${ext}`
}

// ─── Drive 검색 쿼리용 이스케이프 ────────────────────────────
function escapeDriveQuery(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

// ─── 재시도 가능 에러 판별 ───────────────────────────────────
function isRetryable(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const msg = err.message.toLowerCase()
  return (
    msg.includes('429') ||
    msg.includes('ratelimit') ||
    msg.includes('quota') ||
    msg.includes('econnreset') ||
    msg.includes('enotfound') ||
    msg.includes('too many requests')
  )
}

// ─── 단일 이미지 업로드 ──────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function uploadImageToDrive(drive: any, imageUrl: string, fileName: string, imagesFolderId: string): Promise<boolean> {
  try {
    const res = await fetch(imageUrl)
    if (!res.ok) {
      console.warn(`[backup] 이미지 fetch 실패 (${res.status}): ${imageUrl}`)
      return false
    }
    const buffer = await res.arrayBuffer()
    const { Readable } = await import('stream')
    const stream = Readable.from(Buffer.from(buffer))
    const mimeType = res.headers.get('content-type') || 'image/webp'

    const escapedName = escapeDriveQuery(fileName)
    const existing = await drive.files.list({
      q: `name='${escapedName}' and '${imagesFolderId}' in parents and trashed=false`,
      fields: 'files(id)',
    })
    if ((existing.data.files?.length ?? 0) > 0) return true

    await drive.files.create({
      requestBody: { name: fileName, parents: [imagesFolderId], mimeType },
      media: { mimeType, body: stream },
    })
    return true
  } catch (err) {
    console.error(`[backup] 이미지 업로드 실패: ${fileName}`, err)
    return false
  }
}

// ─── 재시도 포함 텍스트 파일 업로드 ──────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function uploadWithRetry(drive: any, fileName: string, md: string, parentId: string, maxRetries = 3): Promise<boolean> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await uploadDriveFile(drive, fileName, md, parentId)
      return true
    } catch (err) {
      if (!isRetryable(err) || attempt === maxRetries - 1) {
        console.error(`[backup] 업로드 최종 실패 (${fileName}):`, err)
        return false
      }
      const delay = 2000 * Math.pow(2, attempt)
      console.warn(`[backup] rate limit, ${delay}ms 후 재시도 (${attempt + 1}/${maxRetries}): ${fileName}`)
      await new Promise((r) => setTimeout(r, delay))
    }
  }
  return false
}

// ─── 재시도 포함 이미지 업로드 (재시도 가능 에러만) ─────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function uploadImageWithRetry(drive: any, imageUrl: string, fileName: string, imagesFolderId: string, maxRetries = 3): Promise<boolean> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const ok = await uploadImageToDrive(drive, imageUrl, fileName, imagesFolderId)
      if (ok) return true
      // uploadImageToDrive가 false를 반환하는 경우(404, fetch 실패 등)는 재시도 불가
      return false
    } catch (err) {
      if (!isRetryable(err) || attempt === maxRetries - 1) {
        console.error(`[backup] 이미지 최종 실패 (${fileName}):`, err)
        return false
      }
      const delay = 2000 * Math.pow(2, attempt)
      console.warn(`[backup] 이미지 rate limit, ${delay}ms 후 재시도 (${attempt + 1}/${maxRetries}): ${fileName}`)
      await new Promise((r) => setTimeout(r, delay))
    }
  }
  return false
}

// ─── 재시도 포함 Drive 폴더 생성 ─────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function createFolderWithRetry(drive: any, name: string, parentId: string, maxRetries = 3): Promise<string> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await createDriveFolder(drive, name, parentId)
    } catch (err) {
      if (!isRetryable(err) || attempt === maxRetries - 1) throw err
      const delay = 2000 * Math.pow(2, attempt)
      console.warn(`[backup] 폴더 생성 rate limit, ${delay}ms 후 재시도 (${attempt + 1}/${maxRetries}): ${name}`)
      await new Promise((r) => setTimeout(r, delay))
    }
  }
  throw new Error(`폴더 생성 실패: ${name}`)
}

// ─── 동시성 제한 병렬 실행 ───────────────────────────────────
async function runConcurrent<T>(
  items: T[],
  fn: (item: T) => Promise<boolean>,
  limit: number
): Promise<number> {
  const queue = [...items]
  let successCount = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift()!
      const ok = await fn(item).catch(() => false)
      if (ok) successCount++
    }
  })
  await Promise.all(workers)
  return successCount
}

// ─── 페이지네이션으로 전체 메모 가져오기 ─────────────────────
async function fetchAllMemos(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const BATCH = 1000
  const result: Array<{
    id: string
    title: string | null
    content: Record<string, unknown> | null
    content_text: string | null
    folder_id: string | null
    tags: string[] | null
    wiki_links: string[] | null
    is_starred: boolean
    is_pinned: boolean
    is_locked: boolean
    locked_content: string | null
    created_at: string
    updated_at: string
  }> = []

  let from = 0
  while (true) {
    const { data: batch, error } = await supabase
      .from('memos')
      .select('id, title, content, content_text, folder_id, tags, wiki_links, is_starred, is_pinned, is_locked, locked_content, created_at, updated_at')
      .eq('user_id', userId)
      .eq('is_deleted', false)
      .order('created_at', { ascending: true })
      .range(from, from + BATCH - 1)

    if (error) {
      console.error('[backup] fetchAllMemos 쿼리 실패 (range', from, '-', from + BATCH - 1, '):', error.message)
      break
    }
    if (!batch || batch.length === 0) break
    result.push(...(batch as typeof result))
    if (batch.length < BATCH) break
    from += BATCH
  }

  return result
}

// ─── content가 비어있으면 content_text로 대체한 Tiptap JSON 반환 ─
function resolveContent(
  content: Record<string, unknown> | null,
  contentText: string | null
): Record<string, unknown> {
  if (content && typeof content === 'object' && Object.keys(content).length > 0) {
    return content
  }
  if (contentText) {
    return {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: contentText }] }],
    }
  }
  return { type: 'doc', content: [{ type: 'paragraph' }] }
}

// ─── POST /api/backup/google-drive ────────────────────────────
// body: { mode: 'individual' | 'combined' }
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })

    const { data: integration } = await supabase
      .from('user_integrations')
      .select('access_token, refresh_token, metadata')
      .eq('user_id', user.id)
      .eq('provider', 'google_drive')
      .single()

    if (!integration?.access_token) {
      return NextResponse.json({ error: 'Google Drive가 연결되지 않았습니다.' }, { status: 403 })
    }

    // PR-2: 잠금 메모 백업 정책 (default: skip)
    const meta = (integration.metadata as Record<string, unknown> | null) ?? {}
    const lockedPolicyRaw = (meta.backupLockedMemos as string) ?? 'skip'
    const lockedPolicy: 'skip' | 'placeholder' | 'ciphertext' =
      lockedPolicyRaw === 'placeholder' || lockedPolicyRaw === 'ciphertext' ? lockedPolicyRaw : 'skip'

    let body: { mode?: string } = {}
    try { body = await req.json() } catch { /* body 없으면 기본값 */ }
    const mode = body.mode === 'combined' ? 'combined' : 'individual'

    const [memos, { data: folders }] = await Promise.all([
      fetchAllMemos(supabase, user.id),
      supabase.from('folders').select('id, name').eq('user_id', user.id),
    ])

    if (!memos.length) {
      return NextResponse.json({ message: '백업할 메모가 없습니다.', count: 0, imageCount: 0 })
    }

    const folderMap = new Map((folders ?? []).map((f) => [f.id, f.name as string]))
    const drive = await getDriveClient(integration.access_token, integration.refresh_token ?? '')
    const now = new Date()
    const dateStr = now.toISOString().slice(0, 10)
    const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '-')
    const backupFolderName = `메모플래너_${dateStr}_${timeStr}`

    // ─── combined 모드: 단일 .md 파일 ────────────────────────
    if (mode === 'combined') {
      const lines: string[] = [
        `# Weave 전체 백업`,
        `> 백업 일시: ${dateStr} ${timeStr.replace(/-/g, ':')}\n`,
        '---',
      ]
      for (const memo of memos) {
        // PR-2: 잠금 메모 정책 처리
        if (memo.is_locked) {
          if (lockedPolicy === 'skip') continue
          if (lockedPolicy === 'placeholder') {
            lines.push(
              `# ${memo.title ?? '제목 없음'}\n\n🔒 잠긴 메모 — 본문 백업 제외\n\n---\n`
            )
            continue
          }
          if (lockedPolicy === 'ciphertext') {
            lines.push(
              `# ${memo.title ?? '제목 없음'}\n\n` +
              `🔒 잠긴 메모 — 암호문\n\n` +
              `\`\`\`\n${memo.locked_content ?? '(empty)'}\n\`\`\`\n\n---\n`
            )
            continue
          }
        }
        try {
          const md = buildMemoMarkdown(
            {
              title: memo.title ?? '',
              createdAt: memo.created_at,
              updatedAt: memo.updated_at,
              folderName: memo.folder_id ? (folderMap.get(memo.folder_id) ?? null) : null,
              tags: memo.tags ?? [],
              wikiLinks: memo.wiki_links ?? [],
              isStarred: memo.is_starred,
              isPinned: memo.is_pinned,
            },
            resolveContent(memo.content, memo.content_text)
          )
          lines.push(md, '\n\n---\n')
        } catch (e) {
          console.error(`[backup] memo ${memo.id} 변환 실패:`, e)
          lines.push(`# ${memo.title ?? '제목 없음'}\n\n*내용 변환 실패*\n\n---\n`)
        }
      }
      const content = lines.join('\n')
      const fileName = `${backupFolderName}_전체백업.md`
      // [BUG FIX 3] combined 모드도 retry 적용
      const ok = await uploadWithRetry(drive, fileName, content, ROOT_FOLDER_ID ?? '')
      if (!ok) {
        return NextResponse.json({ error: '통합 백업 파일 업로드 실패' }, { status: 500 })
      }
      return NextResponse.json({ message: '단일 파일 백업 완료', count: memos.length, imageCount: 0, fileName })
    }

    // ─── individual 모드: 폴더 구조 + 이미지 백업 ────────────
    const rootId = await createDriveFolder(drive, backupFolderName, ROOT_FOLDER_ID)

    // 폴더별 그룹핑
    const groupMap = new Map<string | null, typeof memos>()
    for (const memo of memos) {
      const key = memo.folder_id ?? null
      if (!groupMap.has(key)) groupMap.set(key, [])
      groupMap.get(key)!.push(memo)
    }

    // [BUG FIX 1] 폴더 생성: Promise.all 무제한 병렬 → 순차(5개씩) + retry
    const folderIdMap = new Map<string | null, { memoFolderId: string; imagesFolderId: string | null }>()
    folderIdMap.set(null, { memoFolderId: rootId, imagesFolderId: null })

    // 폴더가 있는 그룹만 순차 생성 (rate limit 방지)
    for (const [folderId, group] of groupMap.entries()) {
      if (folderId === null) continue

      const folderName = folderMap.get(folderId) ?? '알 수 없는 폴더'
      const memoFolderId = await createFolderWithRetry(drive, folderName, rootId)

      const hasAnyImage = group.some((memo) => {
        const c = resolveContent(memo.content, memo.content_text)
        return extractImageUrls(c).length > 0
      })
      const imagesFolderId = hasAnyImage
        ? await createFolderWithRetry(drive, 'images', memoFolderId)
        : null

      folderIdMap.set(folderId, { memoFolderId, imagesFolderId })
    }

    // null 그룹(폴더 없는 메모)에 이미지가 있으면 루트에 images 폴더 생성
    const nullGroup = groupMap.get(null) ?? []
    const nullHasImage = nullGroup.some((memo) => {
      const c = resolveContent(memo.content, memo.content_text)
      return extractImageUrls(c).length > 0
    })
    if (nullHasImage) {
      const imagesRootId = await createFolderWithRetry(drive, 'images', rootId)
      folderIdMap.set(null, { memoFolderId: rootId, imagesFolderId: imagesRootId })
    }

    // ─── 업로드 태스크 구성 ───────────────────────────────────
    interface UploadTask { md: string; fileName: string; parentId: string }
    const uploadTasks: UploadTask[] = []

    interface ImageTask { url: string; fileName: string; imagesFolderId: string }
    const imageTasks: ImageTask[] = []
    const failedMemos: string[] = []
    const failedImages: string[] = []
    let totalImages = 0

    for (const [folderId, group] of groupMap.entries()) {
      const { memoFolderId, imagesFolderId } = folderIdMap.get(folderId)!
      const existingNames = new Set<string>()

      for (const memo of group) {
        // PR-2: 잠금 메모 정책
        if (memo.is_locked) {
          if (lockedPolicy === 'skip') continue
          let placeholderMd: string
          if (lockedPolicy === 'ciphertext') {
            placeholderMd =
              `# ${memo.title ?? '제목 없음'}\n\n` +
              `🔒 잠긴 메모 — 암호문\n\n` +
              `\`\`\`\n${memo.locked_content ?? '(empty)'}\n\`\`\`\n`
          } else { // placeholder
            placeholderMd = `# ${memo.title ?? '제목 없음'}\n\n🔒 잠긴 메모 — 본문 백업 제외\n`
          }
          uploadTasks.push({
            md: placeholderMd,
            fileName: safeFilenameUnique(memo.title ?? '', existingNames),
            parentId: memoFolderId,
          })
          continue
        }

        const resolvedContent = resolveContent(memo.content, memo.content_text)

        let md: string
        try {
          md = buildMemoMarkdown(
            {
              title: memo.title ?? '',
              createdAt: memo.created_at,
              updatedAt: memo.updated_at,
              folderName: folderId ? (folderMap.get(folderId) ?? null) : null,
              tags: memo.tags ?? [],
              wikiLinks: memo.wiki_links ?? [],
              isStarred: memo.is_starred,
              isPinned: memo.is_pinned,
            },
            resolvedContent
          )
        } catch (e) {
          console.error(`[backup] memo ${memo.id} 변환 실패:`, e)
          md = `# ${memo.title ?? '제목 없음'}\n\n*내용 변환 실패*`
        }
        uploadTasks.push({
          md,
          fileName: safeFilenameUnique(memo.title ?? '', existingNames),
          parentId: memoFolderId,
        })

        if (imagesFolderId) {
          const imageUrls = extractImageUrls(resolvedContent)
          for (const url of imageUrls) {
            totalImages++
            imageTasks.push({ url, fileName: getImageFileName(url, memo.title ?? ''), imagesFolderId })
          }
        }
      }
    }

    // ─── 메모 텍스트 병렬 업로드 (동시성 5) ──────────────────
    const successCount = await runConcurrent(
      uploadTasks,
      async (task) => {
        const ok = await uploadWithRetry(drive, task.fileName, task.md, task.parentId)
        if (!ok) failedMemos.push(task.fileName)
        return ok
      },
      5
    )

    // ─── 이미지 병렬 업로드 (동시성 3) ───────────────────────
    const imageSuccessCount = await runConcurrent(
      imageTasks,
      async (task) => {
        const ok = await uploadImageWithRetry(drive, task.url, task.fileName, task.imagesFolderId)
        if (!ok) failedImages.push(task.fileName)
        return ok
      },
      3
    )

    const memoFailCount = uploadTasks.length - successCount
    const imageFailCount = imageTasks.length - imageSuccessCount

    if (memoFailCount > 0 || imageFailCount > 0) {
      console.warn(
        `[backup] 완료 — 메모 ${successCount}/${uploadTasks.length}, ` +
        `이미지 ${imageSuccessCount}/${imageTasks.length}`
      )
    }

    return NextResponse.json({
      message: '개별 파일 백업 완료',
      count: successCount,
      total: uploadTasks.length,
      failCount: memoFailCount,
      failedMemos: failedMemos.slice(0, 50),
      imageCount: imageSuccessCount,
      imageTotal: totalImages,
      imageFailCount,
      failedImages: failedImages.slice(0, 50),
      folderName: backupFolderName,
    })

  } catch (err) {
    const message = err instanceof Error ? err.message : '백업 중 오류가 발생했습니다.'
    console.error('[backup/google-drive] error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// ─── GET — Drive 연결 상태 확인 ──────────────────────────────
export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ connected: false })

    const { data } = await supabase
      .from('user_integrations')
      .select('id')
      .eq('user_id', user.id)
      .eq('provider', 'google_drive')
      .single()

    return NextResponse.json({ connected: !!data })
  } catch {
    return NextResponse.json({ connected: false })
  }
}
