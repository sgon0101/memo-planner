import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { uploadToR2 } from '@/lib/r2/upload'

const MAX_IMAGE_BYTES = 20 * 1024 * 1024  // 20MB
const MAX_VIDEO_BYTES = 200 * 1024 * 1024 // 200MB
const MAX_PDF_BYTES = 50 * 1024 * 1024    // 50MB

const ALLOWED_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml',
  'video/mp4', 'video/webm', 'video/ogg',
  'application/pdf',
])

function getMaxBytes(mimeType: string): number {
  if (mimeType.startsWith('video/')) return MAX_VIDEO_BYTES
  if (mimeType === 'application/pdf') return MAX_PDF_BYTES
  return MAX_IMAGE_BYTES
}

function getFolder(mimeType: string): 'images' | 'videos' | 'files' {
  if (mimeType.startsWith('video/')) return 'videos'
  if (mimeType === 'application/pdf') return 'files'
  return 'images'
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })

  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: '잘못된 요청 형식입니다.' }, { status: 400 })
  }

  const fileEntry = formData.get('file')
  if (!(fileEntry instanceof File)) {
    return NextResponse.json({ error: '파일이 없습니다.' }, { status: 400 })
  }

  const mimeType = fileEntry.type || 'application/octet-stream'
  if (!ALLOWED_TYPES.has(mimeType)) {
    return NextResponse.json({ error: '허용되지 않는 파일 형식입니다.' }, { status: 400 })
  }

  const arrayBuffer = await fileEntry.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  if (buffer.length > getMaxBytes(mimeType)) {
    return NextResponse.json({ error: '파일 크기 제한을 초과했습니다.' }, { status: 413 })
  }

  const folder = getFolder(mimeType)
  const result = await uploadToR2(buffer, mimeType, user.id, folder)

  // 파일 메타데이터 저장 (오류는 무시하고 진행)
  void (async () => {
    await supabase.from('uploaded_files').insert({
      user_id: user.id,
      r2_key: result.key,
      public_url: result.url,
      file_name: fileEntry.name,
      mime_type: result.mimeType,
      original_size: result.originalSize,
      compressed_size: result.compressedSize,
      saved_percent: result.savedPercent,
    })
  })()

  return NextResponse.json({
    url: result.url,
    thumbnailUrl: result.thumbnailUrl,
    key: result.key,
    originalSize: result.originalSize,
    compressedSize: result.compressedSize,
    savedPercent: result.savedPercent,
  })
}
