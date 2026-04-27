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
    // assistant 프리필 '{' → Claude가 반드시 JSON 객체로 시작하도록 강제
    const message = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: 'JSON 객체만 반환하세요. 설명, 마크다운, 추가 텍스트 없이 JSON만.',
      messages: [
        { role: 'user', content: prompt },
        { role: 'assistant', content: '{' },
      ],
    })

    const tail = message.content[0].type === 'text' ? message.content[0].text : ''
    const jsonText = '{' + tail
    try {
      return Response.json(JSON.parse(jsonText))
    } catch {
      const match = jsonText.match(/\{[\s\S]*\}/)
      if (!match) throw new Error('JSON 블록 없음')
      return Response.json(JSON.parse(match[0]))
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : '알 수 없는 오류'
    return Response.json({ error: `분석 실패: ${msg}` }, { status: 500 })
  }
}
