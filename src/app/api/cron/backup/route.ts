import { NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { verifyCronAuth } from '@/lib/security/cronAuth'
import { getDriveClient, createDriveFolder, uploadDriveFile, listBackupFolders, deleteDriveFile, listDriveFiles } from '@/lib/google/drive'
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

// ─── 이미지 증분 백업 (묶음B, 2026-07-12) ─────────────────────
// 배경: 이미지 백업이 수동 '폴더별 백업'에만 있어 4/26~7/1 공백이 생겼고,
// 그 사이 r2-gc 사고로 소실된 이미지 19장이 영구 복구 불가가 됨.
// 설계:
//  - 날짜 스냅샷 폴더가 아닌 **고정 공유 폴더('Weave_이미지')**에 원본만 백업
//    → 매 주기 전체 복사가 아닌 증분(신규만), retention('메모플래너_' prefix)의 삭제 대상이 아님
//  - 변형(md_/thumb_)은 원본에서 재생성 가능하므로 제외 (scripts/backfill-image-variants.ts)
//  - R2에서 404(이미 소실)면 skip — 개별 실패가 md 백업을 막지 않음
//  - deadline 가드: maxDuration(300s) 내 안전 마진에서 중단, 증분이라 다음 주기에 자동 이어짐

function extractR2OriginalUrls(content: unknown, publicUrlPrefix: string): string[] {
  if (!content || !publicUrlPrefix) return []
  const j = JSON.stringify(content)
  const esc = publicUrlPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const urls = j.match(new RegExp(`${esc}/[^"\\\\\\s]+`, 'g')) ?? []
  // 원본만 — 파일명이 md_/thumb_ 로 시작하는 변형 제외, 쿼리스트링 제거
  return [...new Set(
    urls
      .map((u) => u.split('?')[0])
      .filter((u) => {
        const name = u.split('/').pop() ?? ''
        return !name.startsWith('md_') && !name.startsWith('thumb_')
      })
  )]
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function backupImagesIncremental(
  drive: any,
  memos: Array<{ content: Record<string, unknown> | null; is_locked: boolean }>,
  deadlineAt: number,
): Promise<{ uploaded: number; skipped: number; failed: number; timedOut: boolean }> {
  const publicUrl = (process.env.CLOUDFLARE_R2_PUBLIC_URL ?? '').replace(/\/$/, '')
  if (!publicUrl) return { uploaded: 0, skipped: 0, failed: 0, timedOut: false }

  // 전체 메모에서 원본 이미지 URL 수집 (잠금 메모는 content 암호화라 자연 제외)
  const urlSet = new Set<string>()
  for (const m of memos) {
    if (m.is_locked) continue
    extractR2OriginalUrls(m.content, publicUrl).forEach((u) => urlSet.add(u))
  }
  if (urlSet.size === 0) return { uploaded: 0, skipped: 0, failed: 0, timedOut: false }

  // 공유 이미지 폴더 확보 — 'Weave_이미지'는 retention prefix('메모플래너_')와 겹치지 않음
  const IMAGES_FOLDER = 'Weave_이미지'
  const existing = await listBackupFolders(drive, ROOT_FOLDER_ID, IMAGES_FOLDER)
  const folderId = existing[0]?.id ?? await createDriveFolder(drive, IMAGES_FOLDER, ROOT_FOLDER_ID)

  // 기존 백업 파일명 셋 → 증분 판정 (파일명 = R2 키의 파일명, uuid라 전역 유니크)
  const existingFiles = await listDriveFiles(drive, folderId)
  const existingNames = new Set(existingFiles.map((f) => f.name))

  let uploaded = 0, skipped = 0, failed = 0
  for (const url of urlSet) {
    if (Date.now() > deadlineAt) {
      return { uploaded, skipped, failed, timedOut: true }
    }
    const fileName = url.split('/').pop()!
    if (existingNames.has(fileName)) { skipped++; continue }
    try {
      const res = await fetch(url)
      if (!res.ok) { failed++; continue } // 404 = 이미 소실된 이미지 — 백업 불가
      const buf = Buffer.from(await res.arrayBuffer())
      const { Readable } = await import('stream')
      await drive.files.create({
        requestBody: { name: fileName, parents: [folderId] },
        media: {
          mimeType: res.headers.get('content-type') || 'image/webp',
          body: Readable.from(buf),
        },
      })
      uploaded++
    } catch (e) {
      failed++
      console.warn(`[cron/backup] 이미지 백업 실패 (${fileName}):`, e instanceof Error ? e.message : e)
    }
  }
  return { uploaded, skipped, failed, timedOut: false }
}

// ─── GET /api/cron/backup ─────────────────────────────────────
export async function GET(req: Request) {
  if (!verifyCronAuth(req.headers.get('authorization'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 이미지 증분 백업의 deadline 가드용 (maxDuration 300s — 60s 안전 마진)
  const startedAt = Date.now()

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
    // PR-2: 잠금 메모 정책
    const lockedPolicyRaw = (meta.backupLockedMemos as string) ?? 'skip'
    const lockedPolicy: 'skip' | 'placeholder' | 'ciphertext' =
      lockedPolicyRaw === 'placeholder' || lockedPolicyRaw === 'ciphertext' ? lockedPolicyRaw : 'skip'
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
          // PR-2: 잠금 메모 정책 (cron — meta에서 읽음)
          if (memo.is_locked) {
            if (lockedPolicy === 'skip') continue
            let placeholderMd: string
            if (lockedPolicy === 'ciphertext') {
              placeholderMd =
                `# ${memo.title ?? '제목 없음'}\n\n` +
                `🔒 잠긴 메모 — 암호문\n\n` +
                `\`\`\`\n${memo.locked_content ?? '(empty)'}\n\`\`\`\n`
            } else {
              placeholderMd = `# ${memo.title ?? '제목 없음'}\n\n🔒 잠긴 메모 — 본문 백업 제외\n`
            }
            uploadTasks.push({
              md: placeholderMd,
              fileName: safeFilenameUnique(memo.title ?? '', existingNames),
              parentId,
            })
            continue
          }

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

      // ── 이미지 증분 백업 (묶음B) — md 백업과 독립, 실패해도 백업 전체를 막지 않음 ──
      if (meta.backupImages !== false) {
        try {
          const deadlineAt = startedAt + 240_000 // maxDuration 300s — 60s 마진
          const img = await backupImagesIncremental(drive, memos, deadlineAt)
          console.log(
            `[cron/backup] user ${integration.user_id} 이미지 — ` +
            `신규 ${img.uploaded}, 기존 ${img.skipped}, 실패 ${img.failed}` +
            (img.timedOut ? ' (시간 초과로 중단 — 다음 주기에 이어짐)' : '')
          )
        } catch (e) {
          console.warn('[cron/backup] 이미지 백업 단계 실패 (md 백업은 정상):', e)
        }
      }

      // ── Retention: 최근 N개만 유지 (기본 10) ──────────────────
      const retainCount = Math.max(1, Math.min(100, (meta.retainCount as number) ?? 10))
      try {
        const allBackups = await listBackupFolders(drive, ROOT_FOLDER_ID, '메모플래너_')
        // listBackupFolders가 createdTime desc로 정렬되므로 [retainCount:] 가 오래된 것
        const toDelete = allBackups.slice(retainCount)
        if (toDelete.length > 0) {
          console.log(`[cron/backup] retention — 삭제 대상 ${toDelete.length}개`)
          for (const f of toDelete) {
            try { await deleteDriveFile(drive, f.id) } catch (e) {
              console.warn(`[cron/backup] retention 삭제 실패: ${f.name}`, e)
            }
          }
        }
      } catch (e) {
        console.warn('[cron/backup] retention 단계 실패:', e)
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
