/**
 * POST /api/files/presign — 소스 파일 업로드용 presigned PUT URL 발급
 *
 * 바이트는 브라우저 → R2로 직접 간다(Vercel 4.5MB 본문 제한 회피).
 * 서버는 인증·형식·개수·크기·quota만 확인하고 URL을 내준다.
 *
 * 파일별 멱등: (user_id, content_hash)가 이미 있으면 업로드를 생략하고
 * 기존 파일 정보 + 그 파일이 이미 쓰인 노트 목록을 돌려준다.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getUserStorage } from '@/lib/r2/quota'
import { presignPut } from '@/lib/r2/presign'
import {
  MAX_IMAGE_COUNT, MAX_IMAGE_BYTES, MAX_PDF_BYTES,
  SOURCE_IMAGE_TYPES, SOURCE_PDF_TYPE, extForMime,
} from '@/lib/files/sourceLimits'

export const runtime = 'nodejs'

interface PresignInput {
  fileName: string
  size: number
  mimeType: string
  contentHash: string
}

const HASH_RE = /^[0-9a-f]{64}$/

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })

    let body: { files?: PresignInput[] }
    try {
      body = await req.json()
    } catch {
      return NextResponse.json({ error: '잘못된 요청 형식입니다.' }, { status: 400 })
    }

    const files = body.files
    if (!Array.isArray(files) || files.length === 0) {
      return NextResponse.json({ error: '파일이 없습니다.' }, { status: 400 })
    }

    // ── 형식 검증 (PDF와 이미지를 한 세트에 섞지 않는다) ──
    const mimes = new Set(files.map((f) => f.mimeType))
    const isPdfSet = mimes.has(SOURCE_PDF_TYPE)
    const hasImage = files.some((f) => SOURCE_IMAGE_TYPES.has(f.mimeType))
    if (isPdfSet && hasImage) {
      return NextResponse.json({ error: 'PDF와 이미지는 한 번에 함께 올릴 수 없어요. 따로 올려주세요.' }, { status: 400 })
    }
    for (const f of files) {
      if (f.mimeType !== SOURCE_PDF_TYPE && !SOURCE_IMAGE_TYPES.has(f.mimeType)) {
        return NextResponse.json({
          error: f.mimeType === 'image/heic' || f.mimeType === 'image/heif'
            ? 'HEIC는 아직 지원하지 않아요. 갤러리에서 JPG로 공유하거나 캡처 이미지를 선택해 주세요.'
            : `지원하지 않는 형식입니다: ${f.mimeType || '알 수 없음'}`,
        }, { status: 400 })
      }
      if (!f.fileName || typeof f.fileName !== 'string') {
        return NextResponse.json({ error: '파일 이름이 없습니다.' }, { status: 400 })
      }
      if (!Number.isFinite(f.size) || f.size <= 0) {
        return NextResponse.json({ error: '파일 크기가 올바르지 않습니다.' }, { status: 400 })
      }
      if (!HASH_RE.test(f.contentHash ?? '')) {
        return NextResponse.json({ error: '파일 해시가 올바르지 않습니다.' }, { status: 400 })
      }
      const max = f.mimeType === SOURCE_PDF_TYPE ? MAX_PDF_BYTES : MAX_IMAGE_BYTES
      if (f.size > max) {
        return NextResponse.json({
          error: `${f.fileName} — 파일이 너무 커요 (최대 ${Math.round(max / 1024 / 1024)}MB).`,
        }, { status: 413 })
      }
    }
    if (isPdfSet && files.length !== 1) {
      return NextResponse.json({ error: 'PDF는 한 번에 1개만 올릴 수 있어요.' }, { status: 400 })
    }
    if (!isPdfSet && files.length > MAX_IMAGE_COUNT) {
      return NextResponse.json({ error: `이미지는 한 번에 ${MAX_IMAGE_COUNT}장까지예요.` }, { status: 400 })
    }

    // ── 멱등: 이미 올린 파일인지 (user_id, content_hash) ──
    const hashes = files.map((f) => f.contentHash)
    const { data: existingRows } = await supabase
      .from('uploaded_files')
      .select('id, content_hash, public_url, thumbnail_url, image_width, image_height, page_count')
      .eq('user_id', user.id)
      .in('content_hash', hashes)

    const existingByHash = new Map((existingRows ?? []).map((r) => [r.content_hash as string, r]))

    // 기존 파일이 어떤 노트에 쓰였는지 (memo_sources 기준, 영구 삭제된 메모는 자동 제외)
    const existingIds = (existingRows ?? []).map((r) => r.id as string)
    const linkedByFile = new Map<string, { id: string; title: string; inTrash: boolean; position: number }[]>()
    if (existingIds.length > 0) {
      const { data: links } = await supabase
        .from('memo_sources')
        .select('file_id, position, memos!inner(id, title, is_deleted)')
        .in('file_id', existingIds)
      for (const row of links ?? []) {
        const memo = (row as unknown as { memos: { id: string; title: string; is_deleted: boolean } }).memos
        const { file_id: fid, position } = row as unknown as { file_id: string; position: number }
        const arr = linkedByFile.get(fid) ?? []
        // position: 같은 파일 세트라도 순서가 다르면 다른 노트(중복 판정에 사용)
        arr.push({ id: memo.id, title: memo.title || '제목 없음', inTrash: !!memo.is_deleted, position: position ?? 0 })
        linkedByFile.set(fid, arr)
      }
    }

    // ── quota: 신규 업로드분 합계만 검사 ──
    const newBytes = files
      .filter((f) => !existingByHash.has(f.contentHash))
      .reduce((sum, f) => sum + f.size, 0)
    if (newBytes > 0) {
      const usage = await getUserStorage(supabase, user.id)
      if (usage.totalBytes + newBytes > usage.quotaBytes) {
        return NextResponse.json({
          error: `스토리지 한도 초과 (${Math.round(usage.totalBytes / 1024 / 1024)}MB / ${Math.round(usage.quotaBytes / 1024 / 1024)}MB 사용 중). 불필요한 파일을 정리하거나 한도 상향이 필요합니다.`,
          quotaBytes: usage.quotaBytes,
          totalBytes: usage.totalBytes,
        }, { status: 413 })
      }
    }

    // ── presigned URL 발급 (입력 순서 유지) ──
    const results = await Promise.all(files.map(async (f) => {
      const hit = existingByHash.get(f.contentHash)
      if (hit) {
        return {
          deduplicated: true as const,
          fileId: hit.id as string,
          url: hit.public_url as string,
          thumbnailUrl: (hit.thumbnail_url as string | null) ?? null,
          width: (hit.image_width as number | null) ?? null,
          height: (hit.image_height as number | null) ?? null,
          pageCount: (hit.page_count as number | null) ?? null,
          linkedMemos: linkedByFile.get(hit.id as string) ?? [],
        }
      }
      const key = `${user.id}/files/${crypto.randomUUID()}.${extForMime(f.mimeType)}`
      const uploadUrl = await presignPut(key, f.mimeType)
      return { deduplicated: false as const, key, uploadUrl }
    }))

    return NextResponse.json({ files: results })
  } catch (e) {
    console.error('[files/presign] 실패:', e)
    return NextResponse.json({ error: '업로드 준비에 실패했어요. 잠시 후 다시 시도해주세요.' }, { status: 500 })
  }
}
