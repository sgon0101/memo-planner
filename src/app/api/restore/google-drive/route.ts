/**
 * Drive → Weave 복원 (PR-5 E).
 *
 * GET /api/restore/google-drive
 *   - Drive의 백업 폴더 목록 반환 (메모플래너_*)
 *   - 각 폴더의 파일 수, 작성일 포함
 *
 * POST /api/restore/google-drive
 *   body: { folderId, mode?: 'skip' | 'newer-wins' | 'overwrite' }
 *   - 해당 폴더의 모든 .md 파일을 fetch + parseMarkdownMemo
 *   - folderName 기준으로 폴더 자동 생성/매칭
 *   - 메모 upsert (mode에 따라)
 *   - 결과: { restored, skipped, errors }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getDriveClient, listDriveFiles, downloadDriveFile, listBackupFolders } from '@/lib/google/drive'
import { parseMarkdownMemo } from '@/lib/import/fromMarkdown'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

type Mode = 'skip' | 'newer-wins' | 'overwrite'

// ─── GET: 백업 폴더 목록 ────────────────────────────────────────
export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    const { data: integration } = await supabase
      .from('user_integrations')
      .select('access_token, refresh_token')
      .eq('user_id', user.id)
      .eq('provider', 'google_drive')
      .single()

    if (!integration?.access_token) {
      return NextResponse.json({ error: 'Google Drive가 연결되지 않았습니다.' }, { status: 403 })
    }

    const drive = await getDriveClient(integration.access_token, integration.refresh_token ?? '')
    const rootFolderId = process.env.GOOGLE_DRIVE_BACKUP_FOLDER_ID || undefined
    const folders = await listBackupFolders(drive, rootFolderId, '메모플래너_')

    return NextResponse.json({
      folders: folders.map((f) => ({
        id: f.id,
        name: f.name,
        createdAt: f.createdTime,
      })),
    })
  } catch (err) {
    console.error('[restore/google-drive] GET', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : '백업 목록 조회 실패' },
      { status: 500 }
    )
  }
}

// ─── POST: 선택한 폴더 복원 ────────────────────────────────────
interface PostBody {
  folderId: string
  mode?: Mode
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

    let body: PostBody
    try {
      body = await req.json() as PostBody
    } catch {
      return NextResponse.json({ error: '잘못된 요청' }, { status: 400 })
    }
    if (!body.folderId) {
      return NextResponse.json({ error: 'folderId 필요' }, { status: 400 })
    }
    const mode: Mode = body.mode ?? 'skip'

    const { data: integration } = await supabase
      .from('user_integrations')
      .select('access_token, refresh_token')
      .eq('user_id', user.id)
      .eq('provider', 'google_drive')
      .single()
    if (!integration?.access_token) {
      return NextResponse.json({ error: 'Google Drive가 연결되지 않았습니다.' }, { status: 403 })
    }

    const drive = await getDriveClient(integration.access_token, integration.refresh_token ?? '')

    // ─── 폴더 구조 탐색 ──────────────────────────────────────────
    // 백업 루트 폴더 안: [.md 파일들] + [하위 폴더(메모 폴더명)]
    // 하위 폴더 안: [.md 파일들] + (옵션) images/ 폴더
    const rootFiles = await listDriveFiles(drive, body.folderId)

    interface MdTask { fileId: string; fileName: string; folderName: string | null }
    const mdTasks: MdTask[] = []

    // 1. 루트의 .md 파일들 (개별 모드의 폴더 없는 메모)
    for (const f of rootFiles) {
      if (f.mimeType === 'text/markdown' || f.name.toLowerCase().endsWith('.md')) {
        mdTasks.push({ fileId: f.id, fileName: f.name, folderName: null })
      }
    }

    // 2. 루트의 하위 폴더 (각각 메모 폴더)
    const subFolders = rootFiles.filter(
      (f) => f.mimeType === 'application/vnd.google-apps.folder' && f.name !== 'images'
    )
    for (const sub of subFolders) {
      const subFiles = await listDriveFiles(drive, sub.id)
      for (const f of subFiles) {
        if (f.mimeType === 'text/markdown' || f.name.toLowerCase().endsWith('.md')) {
          mdTasks.push({ fileId: f.id, fileName: f.name, folderName: sub.name })
        }
      }
    }

    if (mdTasks.length === 0) {
      return NextResponse.json({
        restored: 0, skipped: 0, errors: 0,
        message: '복원할 .md 파일을 찾지 못했습니다.',
      })
    }

    // ─── 기존 Weave 폴더 lookup (이름 → id) ─────────────────────
    const { data: existingFolders } = await supabase
      .from('folders').select('id, name').eq('user_id', user.id)
    const folderNameToId = new Map<string, string>(
      (existingFolders ?? []).map((f) => [f.name, f.id])
    )

    // ─── 복원 진행 ──────────────────────────────────────────────
    let restored = 0
    let skipped = 0
    let errors = 0
    const errMessages: string[] = []

    for (const task of mdTasks) {
      try {
        const md = await downloadDriveFile(drive, task.fileId)
        const parsed = parseMarkdownMemo(md)

        // 폴더 매칭 — md frontmatter 또는 Drive 폴더명 기준
        const folderName = parsed.folderName || task.folderName
        let folderId: string | null = null
        if (folderName) {
          const cached = folderNameToId.get(folderName)
          if (cached) {
            folderId = cached
          } else {
            // 신규 폴더 생성
            const { data: newF } = await supabase
              .from('folders').insert({
                user_id: user.id, name: folderName,
              }).select().single()
            if (newF?.id) {
              folderId = newF.id
              folderNameToId.set(folderName, newF.id)
            }
          }
        }

        // 같은 제목 + 같은 폴더인 기존 메모 있는지 확인 (newer-wins / skip 결정용)
        // + UPDATE 전 memo_versions 스냅샷을 위해 content/content_text/title도 조회 (2026-07-04 사건 방지)
        const titleEq = parsed.title.trim()
        const { data: existingMemo } = await supabase
          .from('memos')
          .select('id, updated_at, content, content_text, title')
          .eq('user_id', user.id)
          .eq('title', titleEq)
          .eq('folder_id', folderId ?? null)
          .eq('is_deleted', false)
          .maybeSingle()

        const row = {
          user_id: user.id,
          folder_id: folderId,
          title: parsed.title,
          content: parsed.content,
          content_text: parsed.contentText,
          tags: parsed.tags,
          wiki_links: parsed.wikiLinks,
          is_starred: parsed.isStarred,
          is_pinned: parsed.isPinned,
          is_deleted: false,
        }

        if (existingMemo) {
          if (mode === 'skip') { skipped++; continue }
          if (mode === 'newer-wins') {
            // updated_at이 더 새 거면 update
            const incoming = parsed.updatedAt ? new Date(parsed.updatedAt).getTime() : 0
            const existing = new Date(existingMemo.updated_at as string).getTime()
            if (incoming <= existing) { skipped++; continue }
          }
          // overwrite 또는 newer-wins(통과)
          // ─── UPDATE 전 memo_versions에 현재 상태 스냅샷 저장 (롤백 대비, 2026-07-04 사건 재발 방지) ───
          // 이 스냅샷 저장이 실패해도 restore 자체는 계속 진행 (best-effort)
          const { error: snapErr } = await supabase.from('memo_versions').insert({
            memo_id: existingMemo.id,
            content: existingMemo.content,
            content_text: existingMemo.content_text,
            title: existingMemo.title,
          })
          if (snapErr) {
            console.warn('[restore/google-drive] snapshot 실패 (계속 진행)', existingMemo.id, snapErr.message)
          }

          const { error } = await supabase.from('memos').update(row).eq('id', existingMemo.id)
          if (error) { errors++; errMessages.push(`${task.fileName}: ${error.message}`) }
          else restored++
        } else {
          const { error } = await supabase.from('memos').insert(row)
          if (error) { errors++; errMessages.push(`${task.fileName}: ${error.message}`) }
          else restored++
        }
      } catch (e) {
        errors++
        errMessages.push(`${task.fileName}: ${e instanceof Error ? e.message : 'unknown'}`)
      }
    }

    return NextResponse.json({
      restored, skipped, errors,
      total: mdTasks.length,
      mode,
      errorMessages: errMessages.slice(0, 20),
    })
  } catch (err) {
    console.error('[restore/google-drive] POST', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'unknown' },
      { status: 500 }
    )
  }
}
