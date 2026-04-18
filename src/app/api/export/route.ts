import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { memosToMarkdown } from '@/lib/export/markdown'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const format = new URL(req.url).searchParams.get('format') ?? 'json'

  const [{ data: memos }, { data: plans }, { data: folders }] = await Promise.all([
    supabase.from('memos').select('*').eq('user_id', user.id).eq('is_deleted', false).order('updated_at', { ascending: false }),
    supabase.from('plans').select('*').eq('user_id', user.id).order('created_at', { ascending: false }),
    supabase.from('folders').select('*').eq('user_id', user.id).order('order_index'),
  ])

  if (format === 'markdown') {
    const md = memosToMarkdown(memos ?? [])
    return new Response(md, {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="memos-${new Date().toISOString().slice(0, 10)}.md"`,
      },
    })
  }

  // JSON 전체 백업
  const backup = {
    exportedAt: new Date().toISOString(),
    version: '1.0',
    memos: memos ?? [],
    plans: plans ?? [],
    folders: folders ?? [],
  }

  return new Response(JSON.stringify(backup, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="backup-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  })
}

// 가져오기 (JSON 백업 복원)
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  let backup: { memos?: unknown[]; plans?: unknown[]; folders?: unknown[] }
  try {
    backup = await req.json()
  } catch {
    return Response.json({ error: '잘못된 백업 파일입니다.' }, { status: 400 })
  }

  const results = { folders: 0, memos: 0, plans: 0 }

  // 폴더 복원 (id 충돌 무시)
  for (const folder of backup.folders ?? []) {
    const f = folder as Record<string, unknown>
    const { error } = await supabase.from('folders').upsert({
      ...f,
      user_id: user.id,
    }, { onConflict: 'id', ignoreDuplicates: true })
    if (!error) results.folders++
  }

  // 메모 복원
  for (const memo of backup.memos ?? []) {
    const m = memo as Record<string, unknown>
    const { error } = await supabase.from('memos').upsert({
      ...m,
      user_id: user.id,
    }, { onConflict: 'id', ignoreDuplicates: true })
    if (!error) results.memos++
  }

  // 플랜 복원
  for (const plan of backup.plans ?? []) {
    const p = plan as Record<string, unknown>
    const { error } = await supabase.from('plans').upsert({
      ...p,
      user_id: user.id,
    }, { onConflict: 'id', ignoreDuplicates: true })
    if (!error) results.plans++
  }

  return Response.json({ ok: true, results })
}
