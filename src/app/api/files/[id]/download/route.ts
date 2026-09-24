/**
 * GET /api/files/[id]/download?mode=inline|attachment
 *
 * 본인 소유 파일인지 확인한 뒤 R2 presigned GET(60초)으로 302 리다이렉트한다.
 * 바이트는 서버를 거치지 않는다(Vercel 4.5MB 응답 제한 회피).
 *
 * 한글 원본 파일명은 RFC 5987(`filename*=UTF-8''...`)로 보존한다 —
 * R2 키가 UUID이고 공개 URL이 다른 출처(r2.dev)라 `<a download>`이 무시되던 문제 해결.
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { presignGet } from '@/lib/r2/presign'

export const runtime = 'nodejs'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })

    // RLS로도 걸리지만 user_id를 명시해 404/403을 구분 없이 404로 통일 (존재 여부 노출 방지)
    const { data: file } = await supabase
      .from('uploaded_files')
      .select('r2_key, file_name, mime_type')
      .eq('id', id)
      .eq('user_id', user.id)
      .maybeSingle()

    if (!file) return NextResponse.json({ error: '파일을 찾을 수 없어요.' }, { status: 404 })

    const modeParam = req.nextUrl.searchParams.get('mode')
    const mode = modeParam === 'inline' ? 'inline' : 'attachment'

    const url = await presignGet(file.r2_key as string, {
      mimeType: (file.mime_type as string) || 'application/octet-stream',
      fileName: (file.file_name as string) || 'file',
      mode,
    })

    return NextResponse.redirect(url, {
      status: 302,
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (e) {
    console.error('[files/download] 실패:', e)
    return NextResponse.json({ error: '파일을 여는 데 실패했어요.' }, { status: 500 })
  }
}
