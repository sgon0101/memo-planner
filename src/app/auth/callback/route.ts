import { NextResponse } from 'next/server'

// 서버에서 직접 code exchange 하지 않고 클라이언트로 넘김
// (Vercel 환경에서 쿠키 전달 문제 방지)
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const error = searchParams.get('error')

  if (error) {
    return NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error)}`)
  }

  if (code) {
    // 클라이언트 페이지로 code를 전달해 브라우저에서 직접 exchange
    return NextResponse.redirect(`${origin}/auth/confirm?code=${encodeURIComponent(code)}`)
  }

  return NextResponse.redirect(`${origin}/auth/confirm`)
}
