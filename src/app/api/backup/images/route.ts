/**
 * 이미지 백업 즉시 실행 (2026-08-02).
 *
 * 크론(`/api/cron/backup`)의 이미지 증분 백업을 사용자가 직접 돌릴 수 있게 분리한 라우트.
 * 크론은 하루 1회라 전량 변환·재백업에 며칠이 걸리므로, 설정에서 눌러 바로 진행할 수 있게 한다.
 *
 * 이어서 실행 설계:
 *   maxDuration(300s) 안에 다 못 끝내면 남은 개수(remaining)와 done=false를 돌려주고,
 *   클라이언트가 done이 될 때까지 반복 호출한다. 이미 올라간 것은 확장자를 뗀 uuid로
 *   비교해 건너뛰므로(backupImageKey), 중복 업로드 없이 남은 것부터 이어진다.
 */

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getDriveClient, createDriveFolder, listBackupFolders, listDriveFiles } from '@/lib/google/drive'
import {
  convertImageForBackup,
  backupImageKey,
  normalizeBackupImageFormat,
} from '@/lib/backup/imageFormat'

export const runtime = 'nodejs'
export const maxDuration = 300

const ROOT_FOLDER_ID = process.env.GOOGLE_DRIVE_BACKUP_FOLDER_ID || undefined
const IMAGES_FOLDER = 'Weave_이미지'
/** maxDuration 300s — 응답·정리 여유로 60s 마진 */
const TIME_BUDGET_MS = 240_000

/** content 트리에서 R2 원본 이미지 URL만 추출 (md_/thumb_ 변형 제외 — 원본에서 재생성 가능) */
function extractR2OriginalUrls(content: unknown, publicUrlPrefix: string): string[] {
  const out: string[] = []
  const walk = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(walk)
    if (!node || typeof node !== 'object') return
    const n = node as Record<string, unknown>
    if (n.type === 'image' && n.attrs && typeof n.attrs === 'object') {
      const src = (n.attrs as Record<string, unknown>).src
      if (typeof src === 'string') {
        const clean = src.split('?')[0]
        if (clean.startsWith(publicUrlPrefix + '/') && !/\/(md_|thumb_)/.test(clean)) out.push(clean)
      }
    }
    if (Array.isArray(n.content)) n.content.forEach(walk)
  }
  walk(content)
  return out
}

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })

  const publicUrl = (process.env.CLOUDFLARE_R2_PUBLIC_URL ?? '').replace(/\/$/, '')
  if (!publicUrl) return NextResponse.json({ error: 'R2 설정이 없습니다.' }, { status: 500 })

  // Drive 연동 확인
  const { data: integration } = await supabase
    .from('user_integrations')
    .select('access_token, refresh_token, metadata')
    .eq('user_id', user.id)
    .eq('provider', 'google_drive')
    .maybeSingle()

  if (!integration?.access_token) {
    return NextResponse.json({ error: 'Google Drive가 연결되어 있지 않습니다.' }, { status: 400 })
  }

  const meta = (integration.metadata as Record<string, unknown>) ?? {}
  const imageFormat = normalizeBackupImageFormat(meta.backupImageFormat)

  const startedAt = Date.now()
  const deadlineAt = startedAt + TIME_BUDGET_MS

  try {
    const drive = await getDriveClient(integration.access_token, integration.refresh_token ?? '')

    // ── 대상 URL 수집: 메모 content + uploaded_files ──
    const urlSet = new Set<string>()

    // content 스캔 — 배치 200 (대용량 메모가 배치를 터뜨리는 것 방지)
    const BATCH = 200
    for (let from = 0; ; from += BATCH) {
      const { data, error } = await supabase
        .from('memos')
        .select('content, is_locked')
        .eq('user_id', user.id)
        .eq('is_deleted', false)
        .range(from, from + BATCH - 1)
      if (error) {
        return NextResponse.json({ error: `메모 조회 실패: ${error.message}` }, { status: 500 })
      }
      const rows = (data ?? []) as Array<{ content: Record<string, unknown> | null; is_locked: boolean }>
      for (const m of rows) {
        if (m.is_locked) continue  // 잠금 메모는 content가 암호화라 스캔 불가
        extractR2OriginalUrls(m.content, publicUrl).forEach((u) => urlSet.add(u))
      }
      if (rows.length < BATCH) break
    }

    // uploaded_files 병합 — 잠금 메모 이미지 + 버전 이력에만 남은 이미지 커버
    const { data: files, error: filesErr } = await supabase
      .from('uploaded_files')
      .select('public_url')
      .eq('user_id', user.id)
    if (!filesErr) {
      for (const f of (files ?? []) as Array<{ public_url: string | null }>) {
        const u = (f.public_url ?? '').split('?')[0]
        if (u.startsWith(publicUrl + '/')) urlSet.add(u)
      }
    }

    const total = urlSet.size
    if (total === 0) {
      return NextResponse.json({ total: 0, uploaded: 0, skipped: 0, failed: 0, remaining: 0, done: true })
    }

    // ── 공유 이미지 폴더 확보 ('메모플래너_' retention 대상 아님 → 삭제 안전) ──
    const existingFolders = await listBackupFolders(drive, ROOT_FOLDER_ID, IMAGES_FOLDER)
    const folderId = existingFolders[0]?.id ?? await createDriveFolder(drive, IMAGES_FOLDER, ROOT_FOLDER_ID)

    // 확장자를 뗀 uuid로 증분 판정 — 포맷이 바뀌어도 같은 이미지로 인식
    const existingFiles = await listDriveFiles(drive, folderId)
    const existingKeys = new Set(existingFiles.map((f) => backupImageKey(f.name)))

    let uploaded = 0, skipped = 0, failed = 0, converted = 0
    let remaining = 0
    let timedOut = false

    for (const url of urlSet) {
      const fileName = url.split('/').pop()!
      if (existingKeys.has(backupImageKey(fileName))) { skipped++; continue }

      if (Date.now() > deadlineAt) { timedOut = true; remaining++; continue }

      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(15_000) })
        if (!res.ok) { failed++; continue }  // 404 = 이미 소실된 이미지 — 백업 불가
        const raw = Buffer.from(await res.arrayBuffer())
        const srcMime = res.headers.get('content-type') || 'image/webp'
        const out = await convertImageForBackup(raw, srcMime, fileName, imageFormat)
        if (out.converted) converted++

        const { Readable } = await import('stream')
        await drive.files.create({
          requestBody: { name: out.fileName, parents: [folderId] },
          media: { mimeType: out.mimeType, body: Readable.from(out.buffer) },
        })
        existingKeys.add(backupImageKey(fileName))
        uploaded++
      } catch (e) {
        failed++
        console.warn('[backup/images] 실패:', fileName, e instanceof Error ? e.message : e)
      }
    }

    return NextResponse.json({
      total,
      uploaded,
      skipped,
      failed,
      converted,
      remaining,
      done: !timedOut,
      elapsedMs: Date.now() - startedAt,
      format: imageFormat,
    })
  } catch (e) {
    console.error('[backup/images] 오류:', e)
    return NextResponse.json(
      { error: e instanceof Error ? e.message : '이미지 백업 중 오류가 발생했습니다.' },
      { status: 500 },
    )
  }
}
