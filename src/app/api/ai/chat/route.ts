import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { anthropic, MODEL } from '@/lib/ai/claude'
import { chatSystemPrompt } from '@/lib/ai/prompts'
import { extractMemoTexts } from '@/lib/ai/analyzer'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const { messages } = await req.json()

  // 컨텍스트용 최근 데이터
  const [{ data: memos }, { data: plans }] = await Promise.all([
    supabase.from('memos').select('title,content_text,tags').eq('user_id', user.id).eq('is_deleted', false).order('updated_at', { ascending: false }).limit(20),
    supabase.from('plans').select('title').eq('user_id', user.id).order('created_at', { ascending: false }).limit(30),
  ])

  const memoTexts = extractMemoTexts(memos ?? [])
  const planTitles = (plans ?? []).map((p) => p.title)

  // 대화 기록 저장 (마지막 user 메시지)
  const lastUser = [...messages].reverse().find((m: { role: string }) => m.role === 'user')
  if (lastUser) {
    await supabase.from('ai_chats').insert({ user_id: user.id, role: 'user', content: lastUser.content })
  }

  const stream = anthropic.messages.stream({
    model: MODEL,
    max_tokens: 1024,
    system: chatSystemPrompt(memoTexts, planTitles),
    messages,
  })

  const encoder = new TextEncoder()
  const readable = new ReadableStream({
    async start(controller) {
      let fullText = ''
      for await (const chunk of stream) {
        if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
          const text = chunk.delta.text
          fullText += text
          controller.enqueue(encoder.encode(text))
        }
      }
      // assistant 답변 저장
      await supabase.from('ai_chats').insert({ user_id: user.id, role: 'assistant', content: fullText })
      controller.close()
    },
  })

  return new Response(readable, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
