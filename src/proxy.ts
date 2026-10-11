import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

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

  const { data: { user } } = await supabase.auth.getUser()

  // 로그아웃 상태 전용 화면. /reset-password는 재설정 링크로 만든 세션이 필요하므로 여기 넣지 않는다.
  const isAuthRoute =
    pathname.startsWith('/login') || pathname.startsWith('/signup') || pathname.startsWith('/forgot-password')

  if (!user && !isAuthRoute) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  if (user && isAuthRoute) {
    return NextResponse.redirect(new URL('/memo', request.url))
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|icons|images|robots.txt|sitemap.xml|api/drive|api/calendar|api/cron|auth).*)',
  ],
}
