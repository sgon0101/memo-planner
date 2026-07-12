/**
 * 전체 백업 export + import (PR-5 C/D).
 *
 * GET /api/export?format=json|markdown
 *   - json: 모든 user-scoped 테이블 포함 풀백업 (schema_version 2.0)
 *   - markdown: 모든 활성 메모 1개 .md로 (전체 백업 용도)
 *
 * POST /api/export
 *   body: { mode?: 'skip' | 'newer-wins' | 'overwrite', ...backup }
 *   - skip (default): id 충돌 시 무시
 *   - newer-wins: backup의 updated_at이 더 크면 update
 *   - overwrite: 무조건 덮어쓰기
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { memosToMarkdown } from '@/lib/export/markdown'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SCHEMA_VERSION = '2.0'

// PR-5 C: 백업 대상 테이블 (user_id 종속 + 사용자가 복원 가치 있는 데이터)
const BACKUP_TABLES = [
  'folders',
  'memos',
  'memo_versions',
  'plans',
  'plan_templates',
  'chat_rooms',
  'chat_messages',
  'user_profiles',
  'profile_history',
  'recurring_plan_completions',
  'uploaded_files',
] as const

type BackupTable = typeof BACKUP_TABLES[number]
type BackupRow = Record<string, unknown>

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const format = new URL(req.url).searchParams.get('format') ?? 'json'

  if (format === 'markdown') {
    const { data: memos } = await supabase
      .from('memos').select('*')
      .eq('user_id', user.id).eq('is_deleted', false)
      .order('updated_at', { ascending: false })
    const md = memosToMarkdown(memos ?? [])
    return new Response(md, {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="memos-${new Date().toISOString().slice(0, 10)}.md"`,
      },
    })
  }

  // ─── JSON 풀백업 ─────────────────────────────────────────────────
  // memo_versions, chat_messages는 user_id 컬럼이 없거나 다른 경로로 RLS됨
  // → user 본인 메모/방 id를 먼저 가져온 뒤 그것으로 필터
  const tables: Record<string, BackupRow[]> = {}

  // memos 먼저 (다른 테이블에서 참조)
  // ⚠️ 2026-07-11: 전체 풀-select는 대용량 content(base64 인라인 이미지 등)에서
  // 간헐 실패하고, 에러를 무시하면 "메모 0개짜리 빈 백업"이 정상처럼 생성됨
  // (r2-gc 사고와 동일 패턴) → 200행 배치 + 에러 시 명시적 500 반환
  const allMemos: BackupRow[] = []
  {
    let from = 0
    while (true) {
      const { data: batch, error } = await supabase
        .from('memos').select('*').eq('user_id', user.id)
        .order('created_at', { ascending: true })
        .range(from, from + 199)
      if (error) {
        return NextResponse.json(
          { error: `백업 실패: 메모 조회 중 오류 (${error.message}). 빈 백업 파일 생성을 방지하기 위해 중단했습니다.` },
          { status: 500 },
        )
      }
      if (!batch || batch.length === 0) break
      allMemos.push(...(batch as BackupRow[]))
      if (batch.length < 200) break
      from += 200
    }
  }
  tables.memos = allMemos
  const memoIds = tables.memos.map((m) => m.id as string)

  const { data: folders } = await supabase.from('folders').select('*').eq('user_id', user.id)
  tables.folders = (folders ?? []) as BackupRow[]

  const { data: plans } = await supabase.from('plans').select('*').eq('user_id', user.id)
  tables.plans = (plans ?? []) as BackupRow[]

  const { data: planTemplates } = await supabase.from('plan_templates').select('*').eq('user_id', user.id)
  tables.plan_templates = (planTemplates ?? []) as BackupRow[]

  const { data: chatRooms } = await supabase.from('chat_rooms').select('*').eq('user_id', user.id)
  tables.chat_rooms = (chatRooms ?? []) as BackupRow[]
  const roomIds = tables.chat_rooms.map((r) => r.id as string)

  const { data: userProfiles } = await supabase.from('user_profiles').select('*').eq('user_id', user.id)
  tables.user_profiles = (userProfiles ?? []) as BackupRow[]

  const { data: profileHistory } = await supabase.from('profile_history').select('*').eq('user_id', user.id)
  tables.profile_history = (profileHistory ?? []) as BackupRow[]

  const { data: recurCompletions } = await supabase.from('recurring_plan_completions').select('*').eq('user_id', user.id)
  tables.recurring_plan_completions = (recurCompletions ?? []) as BackupRow[]

  const { data: uploadedFiles } = await supabase.from('uploaded_files').select('*').eq('user_id', user.id)
  tables.uploaded_files = (uploadedFiles ?? []) as BackupRow[]

  // memo_versions — RLS로 본인 메모 버전만 조회되지만 명시적으로 in 필터로 보호
  // (대용량 content 버전 대비 200행 배치 — memos와 동일 원리)
  tables.memo_versions = []
  if (memoIds.length > 0) {
    let from = 0
    while (true) {
      const { data: batch, error } = await supabase
        .from('memo_versions').select('*').in('memo_id', memoIds)
        .order('created_at', { ascending: true })
        .range(from, from + 199)
      if (error) {
        return NextResponse.json(
          { error: `백업 실패: 버전 이력 조회 중 오류 (${error.message}).` },
          { status: 500 },
        )
      }
      if (!batch || batch.length === 0) break
      tables.memo_versions.push(...(batch as BackupRow[]))
      if (batch.length < 200) break
      from += 200
    }
  }

  // chat_messages
  if (roomIds.length > 0) {
    const { data: chatMessages } = await supabase
      .from('chat_messages').select('*').in('room_id', roomIds)
    tables.chat_messages = (chatMessages ?? []) as BackupRow[]
  } else {
    tables.chat_messages = []
  }

  const backup = {
    schema_version: SCHEMA_VERSION,
    exported_at: new Date().toISOString(),
    app_version: '2026.06',
    user_email_hash: hashEmail(user.email ?? ''),
    counts: Object.fromEntries(
      Object.entries(tables).map(([k, v]) => [k, v.length])
    ),
    tables,
  }

  return new Response(JSON.stringify(backup, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="weave-backup-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  })
}

// 단순 비식별 해시 — PII 보호용
function hashEmail(email: string): string {
  let h = 5381
  for (let i = 0; i < email.length; i++) h = (h * 33) ^ email.charCodeAt(i)
  return ((h >>> 0).toString(16))
}

// ─── POST: 백업 복원 (mode 옵션) ─────────────────────────────────
type ImportMode = 'skip' | 'newer-wins' | 'overwrite'

interface ImportBody {
  mode?: ImportMode
  schema_version?: string
  tables?: Record<string, BackupRow[]>
  // 옛 schema 1.0 호환
  memos?: BackupRow[]
  plans?: BackupRow[]
  folders?: BackupRow[]
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  let body: ImportBody
  try {
    body = await req.json() as ImportBody
  } catch {
    return Response.json({ error: '잘못된 백업 파일입니다.' }, { status: 400 })
  }

  const mode: ImportMode = body.mode ?? 'skip'
  if (!['skip', 'newer-wins', 'overwrite'].includes(mode)) {
    return Response.json({ error: '알 수 없는 mode' }, { status: 400 })
  }

  // schema 2.0: body.tables / 옛 1.0: body.memos/plans/folders
  const inputTables: Record<string, BackupRow[]> = body.tables
    ? body.tables
    : {
        folders: body.folders ?? [],
        memos: body.memos ?? [],
        plans: body.plans ?? [],
      }

  const results: Record<string, { inserted: number; skipped: number; updated: number }> = {}

  // 적용 순서 — 참조 관계 먼저 (folders → memos → memo_versions ...)
  const order = [
    'folders', 'memos', 'memo_versions', 'plans', 'plan_templates',
    'chat_rooms', 'chat_messages', 'user_profiles', 'profile_history',
    'recurring_plan_completions',
    // uploaded_files는 R2 객체가 없으면 의미 없음 → 복원 제외
  ]

  for (const table of order) {
    const rows = inputTables[table] ?? []
    if (rows.length === 0) continue
    const r = { inserted: 0, skipped: 0, updated: 0 }

    for (const row of rows) {
      const cleaned: BackupRow = { ...row }
      // user_id 강제 — 다른 사용자 row 절대 가져오지 못하게
      if ('user_id' in cleaned) cleaned.user_id = user.id

      const id = cleaned.id as string | undefined
      if (!id) {
        r.skipped++
        continue
      }

      if (mode === 'skip') {
        const { error } = await supabase.from(table).upsert(cleaned, {
          onConflict: 'id',
          ignoreDuplicates: true,
        })
        if (!error) r.inserted++
        else r.skipped++
      } else if (mode === 'overwrite') {
        const { error } = await supabase.from(table).upsert(cleaned, {
          onConflict: 'id',
        })
        if (!error) r.updated++
        else r.skipped++
      } else if (mode === 'newer-wins') {
        // 기존 updated_at 조회
        const incomingUpdated = (cleaned.updated_at as string | undefined) || ''
        const { data: existing } = await supabase
          .from(table)
          .select('updated_at')
          .eq('id', id)
          .maybeSingle()
        if (!existing) {
          // 신규 insert
          const { error } = await supabase.from(table).insert(cleaned)
          if (!error) r.inserted++
          else r.skipped++
        } else {
          const existingUpdated = (existing.updated_at as string | undefined) || ''
          if (incomingUpdated && incomingUpdated > existingUpdated) {
            const { error } = await supabase.from(table).update(cleaned).eq('id', id)
            if (!error) r.updated++
            else r.skipped++
          } else {
            r.skipped++
          }
        }
      }
    }
    results[table] = r
  }

  return Response.json({
    ok: true,
    mode,
    schema_version: body.schema_version ?? '(legacy 1.0)',
    results,
  })
}
