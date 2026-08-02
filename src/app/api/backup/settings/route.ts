import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { normalizeBackupImageFormat, type BackupImageFormat } from '@/lib/backup/imageFormat'

export interface BackupSettings {
  autoBackup: boolean
  period: 'daily' | 'weekly' | 'monthly'
  retainCount: number
  /** PR-2: 잠금 메모 백업 정책. skip=백업 제외, placeholder=잠금 안내문만, ciphertext=암호문 그대로 */
  backupLockedMemos: 'skip' | 'placeholder' | 'ciphertext'
  /**
   * 백업본 이미지 포맷. R2 원본이 WebP라 일반 뷰어에서 안 열리는 경우가 있어
   * 백업할 때만 변환한다. original=WebP 그대로, jpg=JPG(투명도 있으면 PNG), png=PNG.
   * jpg/png/gif/svg 원본은 어떤 값이든 변환하지 않는다.
   */
  backupImageFormat: BackupImageFormat
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
      backupLockedMemos: (meta.backupLockedMemos as BackupSettings['backupLockedMemos']) ?? 'skip',
      backupImageFormat: normalizeBackupImageFormat(meta.backupImageFormat),
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
    const blmRaw = body.backupLockedMemos ?? (prevMeta.backupLockedMemos as string) ?? 'skip'
    const backupLockedMemos: BackupSettings['backupLockedMemos'] =
      blmRaw === 'placeholder' || blmRaw === 'ciphertext' ? blmRaw : 'skip'
    const backupImageFormat = normalizeBackupImageFormat(
      body.backupImageFormat ?? prevMeta.backupImageFormat,
    )

    const nextBackupAt = autoBackup ? calcNextBackupAt(period) : null

    const metadata = {
      ...prevMeta,
      autoBackup,
      period,
      retainCount,
      backupLockedMemos,
      backupImageFormat,
      nextBackupAt,
    }

    await supabase
      .from('user_integrations')
      .update({ metadata, updated_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .eq('provider', 'google_drive')

    return NextResponse.json({ autoBackup, period, retainCount, backupLockedMemos, nextBackupAt, lastBackupAt: prevMeta.lastBackupAt ?? null })
  } catch {
    return NextResponse.json({ error: '설정 저장에 실패했습니다.' }, { status: 500 })
  }
}
