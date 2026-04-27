import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { anthropic, MODEL } from '@/lib/ai/claude'
import { gapAnalysisPrompt, interestAnalysisPrompt } from '@/lib/ai/prompts'
import { extractMemoTexts } from '@/lib/ai/analyzer'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const type = new URL(req.url).searchParams.get('type') ?? 'gap'

  const [{ data: memos }, { data: plans }] = await Promise.all([
    supabase.from('memos').select('title,content_text,tags').eq('user_id', user.id).eq('is_deleted', false).order('updated_at', { ascending: false }).limit(20),
    supabase.from('plans').select('title').eq('user_id', user.id).order('created_at', { ascending: false }).limit(30),
  ])

  const memoTexts = extractMemoTexts(memos ?? [])
  const planTitles = (plans ?? []).map((p) => p.title)

  if (memoTexts.length === 0) {
    return Response.json({ error: 'no_data' })
  }

  const prompt = type === 'interest'
    ? interestAnalysisPrompt(memoTexts)
    : gapAnalysisPrompt(memoTexts, planTitles)

  try {
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: 'You must respond with only a valid JSON object. No explanation, no markdown, no code blocks — raw JSON only.',
      messages: [{ role: 'user', content: prompt }],
    })

    const raw = message.content[0].type === 'text' ? message.content[0].text : ''
    return Response.json(extractJSON(raw))
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
