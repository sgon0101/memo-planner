import { NextRequest } from 'next/server'
import { format, subDays } from 'date-fns'
import { createClient } from '@/lib/supabase/server'
import { anthropic, HAIKU_MODEL } from '@/lib/ai/claude'
import { gapAnalysisPrompt, interestAnalysisPrompt } from '@/lib/ai/prompts'
import { extractMemoTexts } from '@/lib/ai/analyzer'
import { selectMemosForAnalysis } from '@/lib/ai/select'
import { checkRateLimit, rateLimitResponse } from '@/lib/security/rateLimit'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const params = new URL(req.url).searchParams
  const type = params.get('type') ?? 'gap'
  const force = params.get('force') === '1'
  const cacheOnly = params.get('cache_only') === '1' // 캐시 조회만 — AI 호출·한도 차감 없음
  const cacheKey = type === 'interest' ? 'insights_interest' : 'insights_gap'
  const todayStr = format(new Date(), 'yyyy-MM-dd')

  // 24h 캐시 확인 (force=1이면 건너뜀)
  if (!force) {
    const { data: cached } = await supabase
      .from('retro_reports')
      .select('report_json, created_at')
      .eq('user_id', user.id)
      .eq('period', cacheKey)
      .gte('created_at', format(subDays(new Date(), 1), "yyyy-MM-dd'T'HH:mm:ssxxx"))
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (cached?.report_json) {
      return Response.json({ ...(cached.report_json as Record<string, unknown>), cached: true, cachedAt: cached.created_at })
    }
  }

  // cache_only: 캐시 없음을 알리고 종료 (탭 진입만으로 AI 호출·한도 차감되던 문제 방지)
  if (cacheOnly) {
    return Response.json({ none: true })
  }

  // 임베딩 기반 선별: 최근 20개(최근성) + 전체 이력 클러스터 대표(주제 커버리지)
  // 임베딩 부족·오류 시 recent-only로 자동 강등 (기존 동작과 동일)
  const [selection, { data: plans }] = await Promise.all([
    selectMemosForAnalysis(supabase, user.id),
    supabase.from('plans').select('title').eq('user_id', user.id).order('created_at', { ascending: false }).limit(30),
  ])

  const memoTexts = extractMemoTexts(
    selection.recent.map((m) => ({ title: m.title, content_text: m.content_text ?? '', tags: m.tags ?? [] }))
  )
  const representativeTexts = selection.representative.map((m) => {
    const preview = (m.content_text ?? '').slice(0, 200)
    const sizeNote = m.clusterSize && m.clusterSize > 1 ? ` (유사 메모 ${m.clusterSize}개 대표)` : ''
    return `${m.title}${preview ? ` — ${preview}` : ''}${sizeNote}`
  })
  const planTitles = (plans ?? []).map((p) => p.title)

  if (memoTexts.length === 0) {
    return Response.json({ error: 'no_data' })
  }

  // 일일 호출 한도 — 캐시 히트는 위에서 이미 반환됐으므로 실제 AI 호출에만 카운트
  const rate = await checkRateLimit(supabase, 'ai-insights')
  if (!rate.ok) return rateLimitResponse(rate.message)

  const scopeOpts = { representativeTexts, totalMemos: selection.totalMemos }
  const prompt = type === 'interest'
    ? interestAnalysisPrompt(memoTexts, scopeOpts)
    : gapAnalysisPrompt(memoTexts, planTitles, scopeOpts)

  try {
    const message = await anthropic.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 8192,
      system: 'You must respond with only a valid JSON object. No explanation, no markdown, no code blocks — raw JSON only.',
      messages: [{ role: 'user', content: prompt }],
    })

    const raw = message.content[0].type === 'text' ? message.content[0].text : ''
    const result = extractJSON(raw)

    // 분석 범위 메타 — UI 범위 문구용 (캐시에도 함께 저장)
    result.scope = {
      mode: selection.mode,
      total: selection.totalMemos,
      recent: selection.recent.length,
      representative: selection.representative.length,
      plans: planTitles.length,
    }

    // 캐시 저장
    await supabase.from('retro_reports').insert({
      user_id: user.id,
      period: cacheKey,
      period_start: todayStr,
      report_json: result,
    })

    return Response.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : '알 수 없는 오류'
    return Response.json({ error: `분석 실패: ${msg}` }, { status: 500 })
  }
}

function extractJSON(text: string): Record<string, unknown> {
  try { return JSON.parse(text.trim()) } catch {}

  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (codeBlock) {
    try { return JSON.parse(codeBlock[1].trim()) } catch {}
  }

  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start !== -1 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)) } catch {}
  }

  throw new Error('응답에서 JSON을 찾을 수 없습니다.')
}
