import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export interface BackupSettings {
  autoBackup: boolean
  period: 'daily' | 'weekly' | 'monthly'
  retainCount: number
  lastBackupAt: string | null
  nextBackupAt: string | null
}

function calcNextBackupAt(period: string, from: Date = new Date()): string {
  const next = new Date(from)
  next.setHours(2, 0, 0, 0)
  if (period === 'daily') {
    if (next <= from) next.setDate(next.getDate() + 1)
  } else if (period === 'weekly') {
    const daysUntilMonday = (8 - next.getDay()) % 7 || 7
    next.setDate(next.getDate() + daysUntilMonday)
  } else {
    next.setMonth(next.getMonth() + 1, 1)
  }
  return next.toISOString()
}

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })

    const { data } = await supabase
      .from('user_integrations')
      .select('metadata')
      .eq('user_id', user.id)
      .eq('provider', 'google_drive')
      .single()

    const meta = (data?.metadata as Record<string, unknown>) ?? {}
    const settings: BackupSettings = {
      autoBackup: (meta.autoBackup as boolean) ?? false,
      period: (meta.period as BackupSettings['period']) ?? 'weekly',
      retainCount: Math.max(1, Math.min(100, (meta.retainCount as number) ?? 10)),
      lastBackupAt: (meta.lastBackupAt as string) ?? null,
      nextBackupAt: (meta.nextBackupAt as string) ?? null,
    }
    return NextResponse.json(settings)
  } catch {
    return NextResponse.json({ error: '설정을 불러오지 못했습니다.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 })

    const body = await req.json() as Partial<BackupSettings>

    const { data: existing } = await supabase
      .from('user_integrations')
      .select('metadata')
      .eq('user_id', user.id)
      .eq('provider', 'google_drive')
      .single()

    const prevMeta = (existing?.metadata as Record<string, unknown>) ?? {}
    const period = body.period ?? (prevMeta.period as string) ?? 'weekly'
    const autoBackup = body.autoBackup ?? (prevMeta.autoBackup as boolean) ?? false
    const retainCountRaw = body.retainCount ?? (prevMeta.retainCount as number) ?? 10
    const retainCount = Math.max(1, Math.min(100, retainCountRaw))

    const nextBackupAt = autoBackup ? calcNextBackupAt(period) : null

    const metadata = {
      ...prevMeta,
      autoBackup,
      period,
      retainCount,
      nextBackupAt,
    }

    await supabase
      .from('user_integrations')
      .update({ metadata, updated_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .eq('provider', 'google_drive')

    return NextResponse.json({ autoBackup, period, retainCount, nextBackupAt, lastBackupAt: prevMeta.lastBackupAt ?? null })
  } catch {
    return NextResponse.json({ error: '설정 저장에 실패했습니다.' }, { status: 500 })
  }
}
