import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getDriveClient, createDriveFolder, uploadDriveFile } from '@/lib/google/drive'
import { buildMemoMarkdown, safeFilename } from '@/lib/export/toMarkdown'

const ROOT_FOLDER_ID = process.env.GOOGLE_DRIVE_BACKUP_FOLDER_ID!

// POST /api/backup/google-drive
// body: { mode: 'individual' | 'combined' }
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })

  // Drive 연결 확인
  const { data: integration } = await supabase
    .from('user_integrations')
    .select('access_token, refresh_token')
    .eq('user_id', user.id)
    .eq('provider', 'google_drive')
    .single()

  if (!integration?.access_token) {
    return NextResponse.json({ error: 'drive_not_connected' }, { status: 403 })
  }

  const { mode = 'individual' } = await req.json().catch(() => ({ mode: 'individual' }))

  // 메모 + 폴더 조회
  const [{ data: memos }, { data: folders }] = await Promise.all([
    supabase
      .from('memos')
      .select('id, title, content, folder_id, tags, wiki_links, is_starred, is_pinned, created_at, updated_at')
      .eq('user_id', user.id)
      .eq('is_deleted', false)
      .eq('is_locked', false),
    supabase.from('folders').select('id, name').eq('user_id', user.id),
  ])

  if (!memos?.length) {
    return NextResponse.json({ message: '백업할 메모가 없습니다.', count: 0 })
  }

  const folderMap = new Map((folders ?? []).map((f) => [f.id, f.name as string]))
  const drive = await getDriveClient(integration.access_token, integration.refresh_token)
  const now = new Date()
  const dateStr = now.toISOString().slice(0, 10)
  const timeStr = now.toTimeString().slice(0, 8).replace(/:/g, '-')
  const backupFolderName = `메모플래너_${dateStr}_${timeStr}`

  if (mode === 'combined') {
    // 단일 파일 백업: 모든 메모를 하나의 .md 파일로
    const lines: string[] = [
      `# 메모 플래너 전체 백업`,
      `> 백업 일시: ${dateStr} ${timeStr.replace(/-/g, ':')}\n`,
      '---',
    ]
    for (const memo of memos) {
      const md = buildMemoMarkdown(
        {
          title: memo.title,
          createdAt: memo.created_at,
          updatedAt: memo.updated_at,
          folderName: memo.folder_id ? (folderMap.get(memo.folder_id) ?? null) : null,
          tags: memo.tags ?? [],
          wikiLinks: memo.wiki_links ?? [],
          isStarred: memo.is_starred,
          isPinned: memo.is_pinned,
        },
        (memo.content as Record<string, unknown>) ?? {}
      )
      lines.push(md, '\n\n---\n')
    }
    const content = lines.join('\n')
    const fileName = `${backupFolderName}_전체백업.md`
    await uploadDriveFile(drive, fileName, content, ROOT_FOLDER_ID)
    return NextResponse.json({ message: '단일 파일 백업 완료', count: memos.length, fileName })
  }

  // 개별 파일 백업: 폴더 구조 유지
  const rootId = await createDriveFolder(drive, backupFolderName, ROOT_FOLDER_ID)

  // 폴더별 그룹핑
  const groupMap = new Map<string | null, typeof memos>()
  for (const memo of memos) {
    const key = memo.folder_id ?? null
    if (!groupMap.has(key)) groupMap.set(key, [])
    groupMap.get(key)!.push(memo)
  }

  let uploadedCount = 0

  for (const [folderId, group] of groupMap.entries()) {
    let parentId = rootId
    if (folderId !== null) {
      const folderName = folderMap.get(folderId) ?? '알 수 없는 폴더'
      parentId = await createDriveFolder(drive, folderName, rootId)
    }

    for (const memo of group) {
      const md = buildMemoMarkdown(
        {
          title: memo.title,
          createdAt: memo.created_at,
          updatedAt: memo.updated_at,
          folderName: folderId ? (folderMap.get(folderId) ?? null) : null,
          tags: memo.tags ?? [],
          wikiLinks: memo.wiki_links ?? [],
          isStarred: memo.is_starred,
          isPinned: memo.is_pinned,
        },
        (memo.content as Record<string, unknown>) ?? {}
      )
      const fileName = safeFilename(memo.title, memo.created_at)
      await uploadDriveFile(drive, fileName, md, parentId)
      uploadedCount++
    }
  }

  return NextResponse.json({
    message: '개별 파일 백업 완료',
    count: uploadedCount,
    folderName: backupFolderName,
  })
}

// GET — Drive 연결 상태 확인
export async function GET() {
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
}
