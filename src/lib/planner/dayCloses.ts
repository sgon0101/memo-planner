'use client'

/**
 * 하루 마감 기록 (2026-11, 0024 plan_day_closes).
 * 일지를 저장하면 journaled=true, '오늘은 건너뛰기'는 false — 날짜·여부만 남긴다(내용 없음).
 * 스트릭·돌아보기의 '마감한 날'은 이 기록과 일지 메모 날짜의 합집합으로 센다(이 표 이전에 쓴 일지도 포함).
 */

import { createClient } from '@/lib/supabase/client'

export async function recordDayClose(day: string, journaled: boolean): Promise<void> {
  const supabase = createClient()
  const { data: { session } } = await supabase.auth.getSession()
  const userId = session?.user?.id
  if (!userId) return
  const { error } = journaled
    // 일지를 남겼으면 건너뛰기 기록이 있어도 '일지 있음'으로 올린다
    ? await supabase.from('plan_day_closes').upsert({ user_id: userId, day, journaled: true }, { onConflict: 'user_id,day' })
    // 건너뛰기는 이미 일지로 마감한 날을 덮지 않는다
    : await supabase.from('plan_day_closes').upsert({ user_id: userId, day, journaled: false }, { onConflict: 'user_id,day', ignoreDuplicates: true })
  if (error) throw error
}

/** 기간 안의 마감한 날짜들 */
export async function fetchDayCloses(from: string, to: string): Promise<string[]> {
  const { data, error } = await createClient().from('plan_day_closes').select('day').gte('day', from).lte('day', to)
  if (error) throw error
  return (data ?? []).map((r) => r.day as string)
}
