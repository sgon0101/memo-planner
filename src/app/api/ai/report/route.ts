import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { anthropic, MODEL } from '@/lib/ai/claude'
import { retroReportPrompt } from '@/lib/ai/prompts'
import { extractMemoTexts, extractTopTags } from '@/lib/ai/analyzer'
import { format, subDays, subMonths, subQuarters, subYears } from 'date-fns'

const PERIOD_LABELS: Record<string, string> = {
  week: '최근 1주일', month: '최근 1개월', quarter: '최근 3개월', year: '최근 1년',
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const period = (new URL(req.url).searchParams.get('period') ?? 'week') as 'week' | 'month' | 'quarter' | 'year'

  const now = new Date()
  const start = period === 'week' ? subDays(now, 7)
    : period === 'month' ? subMonths(now, 1)
    : period === 'quarter' ? subQuarters(now, 1)
    : subYears(now, 1)
  const startStr = format(start, 'yyyy-MM-dd')

  // 캐시 확인 (24시간 이내)
  const { data: cached } = await supabase
    .from('retro_reports')
    .select('*')
    .eq('user_id', user.id)
    .eq('period', period)
    .gte('created_at', format(subDays(now, 1), "yyyy-MM-dd'T'HH:mm:ssxxx"))
    .order('created_at', { ascending: false })
    .limit(1)
    .single()

  if (cached?.report_json) {
    return Response.json({ ...cached.report_json, cached: true })
  }

  const [{ data: memos }, { data: allPlans }] = await Promise.all([
    supabase.from('memos').select('title,content_text,tags').eq('user_id', user.id).eq('is_deleted', false).gte('created_at', startStr),
    supabase.from('plans').select('title,is_completed').eq('user_id', user.id).gte('created_at', startStr),
  ])

  const memoTexts = extractMemoTexts(memos ?? [])
  const topTags = extractTopTags(memos ?? [])
  const completed = (allPlans ?? []).filter((p) => p.is_completed).length

  const prompt = retroReportPrompt(
    PERIOD_LABELS[period],
    memos?.length ?? 0,
    completed,
    allPlans?.length ?? 0,
    topTags,
    memoTexts,
  )

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = message.content[0].type === 'text' ? message.content[0].text : ''
  let reportJson: Record<string, unknown> = {}
  try {
    reportJson = JSON.parse(text.replace(/```json|```/g, '').trim())
  } catch {
    reportJson = { raw: text }
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
