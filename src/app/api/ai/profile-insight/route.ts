import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { anthropic, MODEL } from '@/lib/ai/claude'

const TRIGGER_KEYWORDS = ['관심', '목표', '고민', '힘들', '좋아', '싫어', '하고 싶', '되고 싶', '가치', '중요', '변화', '느껴', '생각']

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ suggestion: null })

  const { userMessage, aiResponse } = await req.json()
  if (!userMessage) return NextResponse.json({ suggestion: null })

  const hasTrigger = TRIGGER_KEYWORDS.some((k) => userMessage.includes(k))
  if (!hasTrigger) return NextResponse.json({ suggestion: null })

  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 200,
    messages: [{
      role: 'user',
      content: `다음 대화에서 사용자에 대한 새로운 인사이트가 있으면 JSON으로 반환, 없으면 null만 반환.

대화:
사용자: ${userMessage}
AI: ${aiResponse}

반환 형식 (인사이트 있을 때만):
{"field":"interests|personality|recurring_themes|values|behavior_patterns|goals|recent_changes","insight":"구체적 내용","confidence":"high|medium|low"}`,
    }],
  })

  const text = res.content[0].type === 'text' ? res.content[0].text.trim() : ''
  if (text === 'null' || !text) return NextResponse.json({ suggestion: null })

  try {
    const parsed = JSON.parse(text)
    if (!parsed || parsed.confidence === 'low') return NextResponse.json({ suggestion: null })
    return NextResponse.json({ suggestion: parsed })
  } catch {
    return NextResponse.json({ suggestion: null })
  }
}
