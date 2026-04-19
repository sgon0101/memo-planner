import { NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { getDriveClient, createDriveFolder, uploadDriveFile } from '@/lib/google/drive'
import { buildMemoMarkdown, safeFilename } from '@/lib/export/toMarkdown'

const ROOT_FOLDER_ID = process.env.GOOGLE_DRIVE_BACKUP_FOLDER_ID || undefined

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

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  // 자동 백업 켜진 Drive 연동 유저 목록
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
      const [{ data: memos }, { data: folders }] = await Promise.all([
        supabase
          .from('memos')
          .select('id, title, content, folder_id, tags, wiki_links, is_starred, is_pinned, created_at, updated_at')
          .eq('user_id', integration.user_id)
          .eq('is_deleted', false)
          .eq('is_locked', false),
        supabase.from('folders').select('id, name').eq('user_id', integration.user_id),
      ])

      if (!memos?.length) {
        await supabase.from('user_integrations').update({
          metadata: { ...meta, lastBackupAt: new Date().toISOString(), nextBackupAt: calcNextBackupAt(meta.period as string ?? 'weekly') },
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

      const groupMap = new Map<string | null, typeof memos>()
      for (const memo of memos) {
        const key = memo.folder_id ?? null
        if (!groupMap.has(key)) groupMap.set(key, [])
        groupMap.get(key)!.push(memo)
      }

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
        }
      }

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
