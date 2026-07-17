import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { anthropic, MODEL } from '@/lib/ai/claude'
import { retroReportPrompt } from '@/lib/ai/prompts'
import { extractMemoTexts, extractTopTags } from '@/lib/ai/analyzer'
import { checkRateLimit, rateLimitResponse } from '@/lib/security/rateLimit'
import { format, subDays, subMonths, subQuarters, subYears } from 'date-fns'

const PERIOD_LABELS: Record<string, string> = {
  week: '최근 1주일', month: '최근 1개월', quarter: '최근 3개월', year: '최근 1년',
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const params = new URL(req.url).searchParams
  const period = (params.get('period') ?? 'week') as 'week' | 'month' | 'quarter' | 'year'
  const cacheOnly = params.get('cache_only') === '1' // 캐시 조회만 — AI 호출·한도 차감 없음
  const force = params.get('force') === '1'          // 캐시 무시하고 재생성

  const now = new Date()
  const start = period === 'week' ? subDays(now, 7)
    : period === 'month' ? subMonths(now, 1)
    : period === 'quarter' ? subQuarters(now, 1)
    : subYears(now, 1)
  const startStr = format(start, 'yyyy-MM-dd')

  // 캐시 확인 (24시간 이내) — force=1이면 건너뜀
  if (!force) {
    const { data: cached } = await supabase
      .from('retro_reports')
      .select('*')
      .eq('user_id', user.id)
      .eq('period', period)
      .gte('created_at', format(subDays(now, 1), "yyyy-MM-dd'T'HH:mm:ssxxx"))
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (cached?.report_json && (cached.report_json as Record<string, unknown>).headline) {
      return Response.json({ ...cached.report_json, cached: true, cachedAt: cached.created_at })
    }
  }

  // cache_only: 캐시 없음을 알리고 종료 (탭 진입 시 의도치 않은 AI 호출 방지)
  if (cacheOnly) {
    return Response.json({ none: true })
  }

  const [{ data: memos }, { data: allPlans }] = await Promise.all([
    // 잠금 메모는 AI 분석에서 제외 (그래프 분석과 동일 규칙)
    supabase.from('memos').select('title,content_text,tags').eq('user_id', user.id).eq('is_deleted', false).eq('is_locked', false).gte('created_at', startStr),
    supabase.from('plans').select('title,is_completed').eq('user_id', user.id).gte('created_at', startStr),
  ])

  const memoTexts = extractMemoTexts(memos ?? [])
  const topTags = extractTopTags(memos ?? [])
  const completed = (allPlans ?? []).filter((p) => p.is_completed).length

  // 데이터가 아예 없으면 AI 호출 없이 안내
  if (memoTexts.length === 0 && (allPlans?.length ?? 0) === 0) {
    return Response.json({ error: 'no_data' })
  }

  const prompt = retroReportPrompt(
    PERIOD_LABELS[period],
    memos?.length ?? 0,
    completed,
    allPlans?.length ?? 0,
    topTags,
    memoTexts,
  )

  // 일일 호출 한도 — 캐시 히트는 위에서 이미 반환됐으므로 실제 AI 호출에만 카운트
  const rate = await checkRateLimit(supabase, 'ai-report')
  if (!rate.ok) return rateLimitResponse(rate.message)

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = message.content[0].type === 'text' ? message.content[0].text : ''
  let reportJson: Record<string, unknown>
  try {
    reportJson = JSON.parse(text.replace(/```json|```/g, '').trim())
  } catch {
    // 파싱 실패를 캐시에 저장하면 사용자가 24시간 동안 빈 리포트를 보게 됨 — 저장 금지
    console.error('[ai/report] JSON parse failed:', text.slice(0, 300))
    return Response.json({ error: '리포트 생성에 실패했어요. 다시 시도해주세요.' }, { status: 500 })
  }

  // 캐시 저장
  await supabase.from('retro_reports').insert({
    user_id: user.id,
    period,
    period_start: startStr,
    report_json: reportJson,
  })

  return Response.json(reportJson)
}
