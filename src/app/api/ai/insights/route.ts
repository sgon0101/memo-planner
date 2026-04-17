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

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }],
  })

  const text = message.content[0].type === 'text' ? message.content[0].text : ''
  try {
    const json = JSON.parse(text.replace(/```json|```/g, '').trim())
    return Response.json(json)
  } catch {
    return Response.json({ raw: text })
  }
}
