import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('user_id', user.id)
    .single()

  return NextResponse.json(data ?? null)
}

export async function PUT(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { source = 'manual', ...fields } = body

  // 현재 프로필 조회 (이력 기록용)
  const { data: current } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('user_id', user.id)
    .single()

  // 변경된 필드 이력 저장
  const historyInserts = Object.keys(fields)
    .filter((k) => k !== 'user_id' && k !== 'id' && k !== 'created_at' && k !== 'updated_at')
    .map((field) => ({
      user_id: user.id,
      field_name: field,
      old_value: current ? (current as Record<string, unknown>)[field] ?? null : null,
      new_value: (fields as Record<string, unknown>)[field] ?? null,
      source,
    }))

  if (historyInserts.length) {
    await supabase.from('profile_history').insert(historyInserts)
  }

  // 프로필 upsert
  const { data, error } = await supabase
    .from('user_profiles')
    .upsert(
      { user_id: user.id, ...fields, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    )
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
