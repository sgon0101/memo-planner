/**
 * 즐겨찾기(플랜 템플릿) 저장 단일 출처 (2026-11 옵션 정리).
 *
 * 저장 경로가 둘(플랜 폼 북마크·상세 패널 '템플릿으로 저장')이고 둘 다 무조건 insert라
 * 같은 제목이 3개씩 쌓였다(운영 실측: 10개 중 중복 5개). 같은 제목(공백·대소문자 무시)이
 * 있으면 그 행을 갱신한다. 이미 쌓인 중복은 지우지 않고 화면에서만 하나로 묶는다.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { PlanTemplate } from '@/types'

export function templateKey(title: string): string {
  return title.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase()
}

/** 같은 제목은 첫 번째(정렬상 가장 많이 쓴 것)만 남긴다 — 표시용 */
export function dedupeTemplates<T extends { title: string }>(list: T[]): T[] {
  const seen = new Set<string>()
  return list.filter((t) => {
    const k = templateKey(t.title)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

export interface TemplateFields {
  title: string
  color: string
  start_time: string | null
  end_time: string | null
  is_all_day: boolean
  linked_memo_ids: string[]
  description: string | null
  rrule_str: string | null
  notify_enabled: boolean
  notify_lead_min: number
}

/**
 * 같은 제목이 있으면 갱신, 없으면 추가. 반환: 저장된 행 + 갱신 여부.
 * 서버에서 같은 제목을 다시 조회해 판정한다(화면 목록이 오래됐어도 중복이 생기지 않게).
 */
export async function upsertTemplate(
  supabase: SupabaseClient,
  userId: string,
  fields: TemplateFields,
): Promise<{ row: Record<string, unknown>; updated: boolean }> {
  const key = templateKey(fields.title)
  const { data: existing, error: findErr } = await supabase
    .from('plan_templates')
    .select('id, title, use_count')
    .eq('user_id', userId)
    .order('use_count', { ascending: false })
  if (findErr) throw findErr
  const matches = (existing ?? []).filter((r) => templateKey(r.title as string) === key)
  if (matches.length > 0) {
    // 과거에 쌓인 같은 제목 중복이 있으면 전부 같은 내용으로 맞춘다 — 화면에 어느 행이 보이든 결과가 같게
    const { data, error } = await supabase
      .from('plan_templates')
      .update({ ...fields, title: fields.title.trim() })
      .in('id', matches.map((r) => r.id as string))
      .select()
    if (error) throw error
    const row = (data ?? []).find((r) => r.id === matches[0].id) ?? (data ?? [])[0]
    if (!row) throw new Error('즐겨찾기를 찾지 못했어요.')
    return { row, updated: true }
  }
  const { data, error } = await supabase
    .from('plan_templates')
    .insert({ ...fields, title: fields.title.trim(), user_id: userId })
    .select()
    .single()
  if (error) throw error
  return { row: data, updated: false }
}

export function rowToTemplate(r: Record<string, unknown>): PlanTemplate {
  return {
    id: r.id as string,
    userId: r.user_id as string,
    title: r.title as string,
    color: r.color as string,
    startTime: (r.start_time as string) ?? null,
    endTime: (r.end_time as string) ?? null,
    isAllDay: (r.is_all_day as boolean) ?? true,
    linkedMemoIds: (r.linked_memo_ids as string[]) ?? [],
    description: (r.description as string) ?? null,
    rruleStr: (r.rrule_str as string) ?? null,
    notifyEnabled: (r.notify_enabled as boolean) ?? false,
    notifyLeadMin: (r.notify_lead_min as number) ?? 10,
    useCount: (r.use_count as number) ?? 0,
    lastUsedAt: (r.last_used_at as string) ?? null,
    createdAt: r.created_at as string,
  }
}

/** 같은 제목(키)의 즐겨찾기 행 id 전부 — 삭제 시 숨은 중복이 다시 나타나지 않게 */
export async function templateIdsWithSameKey(supabase: SupabaseClient, title: string): Promise<string[]> {
  const key = templateKey(title)
  const { data, error } = await supabase.from('plan_templates').select('id, title')
  if (error) throw error
  return (data ?? []).filter((r) => templateKey(r.title as string) === key).map((r) => r.id as string)
}
