import { NextResponse } from 'next/server'

// 서버에서 직접 code exchange 하지 않고 클라이언트로 넘김
// (Vercel 환경에서 쿠키 전달 문제 방지)
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const error = searchParams.get('error')
  // 비밀번호 재설정 등 후속 이동 경로 — 같은 사이트 내부 경로만 허용 (open redirect 방지)
  const nextRaw = searchParams.get('next')
  const next = nextRaw && nextRaw.startsWith('/') && !nextRaw.startsWith('//') ? nextRaw : null
  const nextQs = next ? `&next=${encodeURIComponent(next)}` : ''

  if (error) {
    if (next === '/reset-password') return NextResponse.redirect(`${origin}/forgot-password?error=link`)
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error)}`)
  }

  if (code) {
    // 클라이언트 페이지로 code를 전달해 브라우저에서 직접 exchange
    return NextResponse.redirect(`${origin}/auth/confirm?code=${encodeURIComponent(code)}${nextQs}`)
  }

  return NextResponse.redirect(`${origin}/auth/confirm${next ? `?next=${encodeURIComponent(next)}` : ''}`)
}
