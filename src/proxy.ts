import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { isPublicPage } from '@/lib/site'

const SKIP_PATHS = [
  '/manifest.json',
  '/robots.txt',
  '/sitemap.xml',
  '/favicon.ico',
  '/icons/',
  '/images/',
  '/api/drive',
  '/api/calendar',
  '/api/cron',
  '/auth',
  '/_next',
]

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  if (SKIP_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next()
  }
  // public/ 정적 파일(로고·아이콘·sw.js·offline.html 등) — 로그인 전 화면(공개 페이지·로그인)도 써야 한다.
  // 예전엔 /weave-logo.svg·/sw.js까지 /login으로 307 리다이렉트됐다.
  if (/\.(?:svg|png|jpe?g|webp|gif|ico|js|html|txt|xml|webmanifest)$/.test(pathname)) {
    return NextResponse.next()
  }

  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // getClaims(): 먼저 getSession()으로 만료 토큰을 갱신(쿠키 저장 포함)한 뒤, 비대칭 서명키(ES256)면
  // Supabase Auth 서버에 묻지 않고 JWKS로 서명만 검증한다 — 매 요청 getUser() 왕복을 없애 첫 화면을 빠르게.
  // (대칭키면 내부에서 getUser()로 돌아가 예전과 동일.) 실제 데이터 접근은 RLS가 막고,
  // 계정 삭제처럼 최신 상태가 필요한 API 라우트는 계속 getUser()를 쓴다.
  //
  // 판정이 '모름'일 때는 로그인 화면으로 보내지 않는다(2026-11-14): 모바일 네트워크 순간 끊김·Supabase 5xx·
  // JWKS 조회 실패처럼 일시적인 이유로 토큰 갱신/검증이 실패하면 예전엔 바로 /login으로 보내 '갑자기 로그아웃'처럼
  // 보였다. 이때 세션 쿠키는 그대로 남아 있으므로(auth-js는 재시도 가능한 오류에선 세션을 지우지 않음) 요청을
  // 그대로 통과시키고, 화면의 클라이언트가 다시 갱신하게 둔다. 데이터 접근은 어차피 RLS가 막는다.
  // 4xx(갱신 토큰 폐기·잘못된 토큰 등)만 확실한 로그아웃으로 본다.
  let isLoggedIn = false
  let authUnknown = false
  try {
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims()
    isLoggedIn = !!claimsData?.claims?.sub
    if (!isLoggedIn && claimsError) {
      const status = (claimsError as { status?: number }).status ?? 0
      authUnknown = !(status >= 400 && status < 500)
      if (authUnknown) {
        console.error('[weave:auth] 로그인 판정 일시 실패 — 리디렉트 없이 통과', pathname, claimsError.name, status)
      }
    }
  } catch (e) {
    authUnknown = true
    console.error('[weave:auth] 로그인 판정 예외 — 리디렉트 없이 통과', pathname, e instanceof Error ? e.name : e)
  }
  if (authUnknown) {
    return supabaseResponse
  }

  // 갱신된 토큰 쿠키를 리디렉트 응답에도 옮겨 담는다 — 빠뜨리면 갱신 토큰을 잃고 로그아웃될 수 있다.
  const redirectTo = (path: string) => {
    const res = NextResponse.redirect(new URL(path, request.url))
    supabaseResponse.cookies.getAll().forEach((c) => res.cookies.set(c))
    return res
  }

  // 로그아웃 상태 전용 화면. /reset-password는 재설정 링크로 만든 세션이 필요하므로 여기 넣지 않는다.
  const isAuthRoute =
    pathname.startsWith('/login') || pathname.startsWith('/signup') || pathname.startsWith('/forgot-password')

  // 로그인 사용자의 '/'는 페이지를 렌더하지 않고 바로 /home으로 (예전엔 page.tsx가 렌더 중 판단)
  if (pathname === '/' && isLoggedIn) {
    return redirectTo('/home')
  }

  // 공개 페이지(/, /about, /privacy, /terms) — 로그아웃 상태에서도 그대로 연다
  if (isPublicPage(pathname)) {
    return supabaseResponse
  }

  if (!isLoggedIn && !isAuthRoute) {
    return redirectTo('/login')
  }

  if (isLoggedIn && isAuthRoute) {
    return redirectTo('/memo')
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|icons|images|robots.txt|sitemap.xml|api/drive|api/calendar|api/cron|auth).*)',
  ],
}
