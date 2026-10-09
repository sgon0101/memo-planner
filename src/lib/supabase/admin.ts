import 'server-only'
import { createClient } from '@supabase/supabase-js'

/**
 * 서비스 롤 클라이언트 — RLS를 우회한다.
 * 쓰는 쪽이 반드시 `.eq('user_id', <검증된 사용자 id>)`로 범위를 직접 좁혀야 한다.
 */
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  )
}
