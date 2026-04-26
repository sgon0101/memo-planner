import { NextRequest, NextResponse } from 'next/server'

// Vercel 최대 실행 시간 (Pro: 60s, Hobby: 10s)
export const maxDuration = 60
import { createClient } from '@/lib/supabase/server'
import { getDriveClient, createDriveFolder, uploadDriveFile } from '@/lib/google/drive'
import { buildMemoMarkdown, safeFilenameUnique } from '@/lib/export/toMarkdown'

const ROOT_FOLDER_ID = process.env.GOOGLE_DRIVE_BACKUP_FOLDER_ID || undefined

// Tiptap JSON에서 이미지 URL 추출
function extractImageUrls(content: Record<string, unknown>): string[] {
  const urls: string[] = []
  function traverse(node: Record<string, unknown>) {
    if (node.type === 'image' && typeof node.attrs === 'object') {
      const src = (node.attrs as Record<string, unknown>)?.src
      if (typeof src === 'string' && src) urls.push(src)
    }
    const children = node.content as Record<string, unknown>[] | undefined
    if (children) children.forEach(traverse)
  }
  traverse(content)
  return urls
}

function getImageFileName(url: string, memoTitle: string): string {
  const parts = url.split('/')
  const original = parts[parts.length - 1].split('?')[0]
  const ext = original.includes('.') ? original.split('.').pop() : 'webp'
  const uuid8 = original.replace(/\.[^.]+$/, '').slice(0, 8)
  const safeTitle = memoTitle
    .replace(/[<>:"/\\|?*\[\]]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 30)
    .replace(/_+$/, '') || 'memo'
  return `${safeTitle}_${uuid8}.${ext}`
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function uploadImageToDrive(drive: any, imageUrl: string, fileName: string, imagesFolderId: string): Promise<void> {
  try {
    const res = await fetch(imageUrl)
    if (!res.ok) return
    const buffer = await res.arrayBuffer()
    const { Readable } = await import('stream')
    const stream = Readable.from(Buffer.from(buffer))
    const mimeType = res.headers.get('content-type') || 'image/webp'

    // 중복 방지
    const existing = await drive.files.list({
      q: `name='${fileName}' and '${imagesFolderId}' in parents and trashed=false`,
      fields: 'files(id)',
    })
    if (existing.data.files?.length > 0) return

    await drive.files.create({
      requestBody: { name: fileName, parents: [imagesFolderId], mimeType },
      media: { mimeType, body: stream },
    })
  } catch (err) {
    console.error(`[backup] 이미지 업로드 실패: ${fileName}`, err)
    // 이미지 실패해도 전체 백업 계속 진행
  }
}

// 동시성 제한 병렬 실행 헬퍼
async function runConcurrent<T>(
  items: T[],
  fn: (item: T) => Promise<void>,
  limit: number
): Promise<void> {
  const queue = [...items]
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift()!
      await fn(item).catch(console.error)
    }
  })
  await Promise.all(workers)
}

// 1000개 초과 시도 모두 가져오는 페이지네이션 헬퍼
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
      .eq('is_locked', false)
      .order('created_at', { ascending: true })
      .range(from, from + BATCH - 1)

    if (error || !batch || batch.length === 0) break
    result.push(...(batch as typeof result))
    if (batch.length < BATCH) break
    from += BATCH
  }

  return result
}

// content가 비어있으면 content_text로 대체한 Tiptap JSON 반환
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

// POST /api/backup/google-drive
// body: { mode: 'individual' | 'combined' }
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })

    const { data: integration } = await supabase
      .from('user_integrations')
      .select('access_token, refresh_token')
      .eq('user_id', user.id)
      .eq('provider', 'google_drive')
      .single()

    if (!integration?.access_token) {
      return NextResponse.json({ error: 'Google Drive가 연결되지 않았습니다.' }, { status: 403 })
    }

    let body: { mode?: string } = {}
    try { body = await req.json() } catch { /* body 없으면 기본값 */ }
    const mode = body.mode === 'combined' ? 'combined' : 'individual'

    // 페이지네이션으로 전체 메모 수집 (1000개 이상도 누락 없이)
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

    if (mode === 'combined') {
      const lines: string[] = [
        `# 메모 플래너 전체 백업`,
        `> 백업 일시: ${dateStr} ${timeStr.replace(/-/g, ':')}\n`,
        '---',
      ]
      for (const memo of memos) {
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
      }
      const content = lines.join('\n')
      const fileName = `${backupFolderName}_전체백업.md`
      await uploadDriveFile(drive, fileName, content, ROOT_FOLDER_ID)
      return NextResponse.json({ message: '단일 파일 백업 완료', count: memos.length, imageCount: 0, fileName })
    }

    // 개별 파일 백업: 폴더 구조
    const rootId = await createDriveFolder(drive, backupFolderName, ROOT_FOLDER_ID)

    // 폴더별 그룹핑
    const groupMap = new Map<string | null, typeof memos>()
    for (const memo of memos) {
      const key = memo.folder_id ?? null
      if (!groupMap.has(key)) groupMap.set(key, [])
      groupMap.get(key)!.push(memo)
    }

    // 폴더 생성 (순차 — 각 parentId가 필요하므로)
    const folderIdMap = new Map<string | null, string>() // folderId → drive parentId
    folderIdMap.set(null, rootId) // 폴더 없는 메모 → 루트

    for (const [folderId] of groupMap.entries()) {
      if (folderId !== null) {
        const folderName = folderMap.get(folderId) ?? '알 수 없는 폴더'
        const driveParentId = await createDriveFolder(drive, folderName, rootId)
        folderIdMap.set(folderId, driveParentId)
      }
    }

    // 업로드 태스크 구성 (이름 중복 방지는 폴더별로)
    interface UploadTask { md: string; fileName: string; parentId: string }
    const uploadTasks: UploadTask[] = []

    for (const [folderId, group] of groupMap.entries()) {
      const parentId = folderIdMap.get(folderId) ?? rootId
      const existingNames = new Set<string>()
      for (const memo of group) {
        const md = buildMemoMarkdown(
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
        uploadTasks.push({ md, fileName: safeFilenameUnique(memo.title ?? '', existingNames), parentId })
      }
    }

    // 메모 파일 병렬 업로드 (10개씩 동시)
    await runConcurrent(
      uploadTasks,
      async ({ md, fileName, parentId }) => { await uploadDriveFile(drive, fileName, md, parentId) },
      10
    )

    return NextResponse.json({
      message: '개별 파일 백업 완료',
      count: uploadTasks.length,
      imageCount: 0,
      folderName: backupFolderName,
    })

  } catch (err) {
    const message = err instanceof Error ? err.message : '백업 중 오류가 발생했습니다.'
    console.error('[backup/google-drive] error:', err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// GET — Drive 연결 상태 확인
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
