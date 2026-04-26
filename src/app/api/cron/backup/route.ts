import { NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { getDriveClient, createDriveFolder, uploadDriveFile } from '@/lib/google/drive'
import { buildMemoMarkdown, safeFilenameUnique } from '@/lib/export/toMarkdown'

export const maxDuration = 300

const ROOT_FOLDER_ID = process.env.GOOGLE_DRIVE_BACKUP_FOLDER_ID || undefined

// ─── 다음 백업 예정 시각 계산 ────────────────────────────────
function isDue(nextBackupAt: string | null): boolean {
  if (!nextBackupAt) return false
  return new Date(nextBackupAt) <= new Date()
}

function calcNextBackupAt(period: string): string {
  const next = new Date()
  next.setHours(2, 0, 0, 0)
  if (period === 'daily') {
    next.setDate(next.getDate() + 1)
  } else if (period === 'weekly') {
    const daysUntilMonday = (8 - next.getDay()) % 7 || 7
    next.setDate(next.getDate() + daysUntilMonday)
  } else {
    next.setMonth(next.getMonth() + 1, 1)
  }
  return next.toISOString()
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

// ─── 재시도 포함 텍스트 파일 업로드 ──────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function uploadWithRetry(drive: any, fileName: string, md: string, parentId: string, maxRetries = 3): Promise<boolean> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      await uploadDriveFile(drive, fileName, md, parentId)
      return true
    } catch (err) {
      if (!isRetryable(err) || attempt === maxRetries - 1) {
        console.error(`[cron/backup] 업로드 최종 실패 (${fileName}):`, err)
        return false
      }
      const delay = 2000 * Math.pow(2, attempt)
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAllMemos(supabase: any, userId: string) {
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
    created_at: string
    updated_at: string
  }> = []

  let from = 0
  while (true) {
    const { data: batch, error } = await supabase
      .from('memos')
      .select('id, title, content, content_text, folder_id, tags, wiki_links, is_starred, is_pinned, created_at, updated_at')
      .eq('user_id', userId)
      .eq('is_deleted', false)
      .order('created_at', { ascending: true })
      .range(from, from + BATCH - 1)

    if (error) {
      console.error('[cron/backup] fetchAllMemos 실패 (range', from, '-', from + BATCH - 1, '):', error.message)
      break
    }
    if (!batch || batch.length === 0) break
    result.push(...(batch as typeof result))
    if (batch.length < BATCH) break
    from += BATCH
  }

  return result
}

// ─── content가 비어있으면 content_text로 대체 ────────────────
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

// ─── GET /api/cron/backup ─────────────────────────────────────
export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data: integrations } = await supabase
    .from('user_integrations')
    .select('user_id, access_token, refresh_token, metadata')
    .eq('provider', 'google_drive')

  if (!integrations?.length) return NextResponse.json({ processed: 0 })

  let processed = 0

  for (const integration of integrations) {
    const meta = (integration.metadata as Record<string, unknown>) ?? {}
    if (!meta.autoBackup) continue
    if (!isDue(meta.nextBackupAt as string | null)) continue
    if (!integration.access_token) continue

    try {
      const [memos, { data: folders }] = await Promise.all([
        fetchAllMemos(supabase, integration.user_id),
        supabase.from('folders').select('id, name').eq('user_id', integration.user_id),
      ])

      // 메모 없어도 다음 예정 시각 업데이트
      if (!memos.length) {
        await supabase.from('user_integrations').update({
          metadata: {
            ...meta,
            lastBackupAt: new Date().toISOString(),
            nextBackupAt: calcNextBackupAt((meta.period as string) ?? 'weekly'),
          },
        }).eq('user_id', integration.user_id).eq('provider', 'google_drive')
        continue
      }

      const folderMap = new Map((folders ?? []).map((f) => [f.id, f.name as string]))
      const drive = await getDriveClient(integration.access_token, integration.refresh_token ?? '')

      const now = new Date()
      const dateStr = now.toISOString().slice(0, 10)
      const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '-')
      const backupFolderName = `메모플래너_자동_${dateStr}_${timeStr}`
      const rootId = await createDriveFolder(drive, backupFolderName, ROOT_FOLDER_ID)

      // 폴더별 그룹핑
      const groupMap = new Map<string | null, typeof memos>()
      for (const memo of memos) {
        const key = memo.folder_id ?? null
        if (!groupMap.has(key)) groupMap.set(key, [])
        groupMap.get(key)!.push(memo)
      }

      // 폴더 생성 (순차 + retry — 병렬 생성 시 rate limit 위험)
      const folderIdMap = new Map<string | null, string>()
      folderIdMap.set(null, rootId)

      for (const [folderId] of groupMap.entries()) {
        if (folderId === null) continue
        const folderName = folderMap.get(folderId) ?? '알 수 없는 폴더'
        const driveParentId = await createFolderWithRetry(drive, folderName, rootId)
        folderIdMap.set(folderId, driveParentId)
      }

      // 업로드 태스크 구성
      interface UploadTask { md: string; fileName: string; parentId: string }
      const uploadTasks: UploadTask[] = []

      for (const [folderId, group] of groupMap.entries()) {
        const parentId = folderIdMap.get(folderId) ?? rootId
        const existingNames = new Set<string>()

        for (const memo of group) {
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
              resolveContent(memo.content, memo.content_text)
            )
          } catch (e) {
            console.error(`[cron/backup] memo ${memo.id} 변환 실패:`, e)
            md = `# ${memo.title ?? '제목 없음'}\n\n*내용 변환 실패*`
          }
          uploadTasks.push({
            md,
            fileName: safeFilenameUnique(memo.title ?? '', existingNames),
            parentId,
          })
        }
      }

      // 병렬 업로드 (동시성 5 + retry)
      const successCount = await runConcurrent(
        uploadTasks,
        (task) => uploadWithRetry(drive, task.fileName, task.md, task.parentId),
        5
      )

      const failCount = uploadTasks.length - successCount
      console.log(
        `[cron/backup] user ${integration.user_id} — ` +
        `성공: ${successCount}/${uploadTasks.length}` +
        (failCount > 0 ? `, 실패: ${failCount}` : '')
      )

      await supabase.from('user_integrations').update({
        metadata: {
          ...meta,
          lastBackupAt: new Date().toISOString(),
          nextBackupAt: calcNextBackupAt((meta.period as string) ?? 'weekly'),
        },
      }).eq('user_id', integration.user_id).eq('provider', 'google_drive')

      processed++
    } catch (err) {
      console.error(`[cron/backup] user ${integration.user_id} 실패:`, err)
    }
  }

  return NextResponse.json({ processed })
}
