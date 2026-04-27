import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { anthropic, MODEL } from '@/lib/ai/claude'
import { profileChatSystemPrompt } from '@/lib/ai/prompts'

export const maxDuration = 60 // Vercel Pro: 최대 60초 스트리밍 허용

const RECENT_WINDOW = 20

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const { roomId, message } = await req.json()
  if (!roomId || !message) return new Response('Bad Request', { status: 400 })

  // user_profile 로드
  const [{ data: profile }, { data: recentMemos }, { data: roomData }, { data: history }] =
    await Promise.all([
      supabase
        .from('user_profiles')
        .select('interests, personality, recurring_themes, values, behavior_patterns, goals, recent_changes, raw_notes')
        .eq('user_id', user.id)
        .single(),
      supabase
        .from('memos')
        .select('title, content_text, tags, folders(name)')
        .eq('user_id', user.id)
        .eq('is_deleted', false)
        .order('updated_at', { ascending: false })
        .limit(20),
      supabase
        .from('chat_rooms')
        .select('title, summary, message_count')
        .eq('id', roomId)
        .eq('user_id', user.id)
        .single(),
      supabase
        .from('chat_messages')
        .select('role, content')
        .eq('room_id', roomId)
        .eq('is_summarized', false)
        .order('created_at', { ascending: false })
        .limit(RECENT_WINDOW),
    ])

  if (!roomData) return new Response('Room not found', { status: 404 })

  // 최근 메시지 시간순 정렬
  const historyMessages = (history ?? []).reverse()

  // 사용자 메시지 즉시 저장
  await supabase.from('chat_messages').insert({
    room_id: roomId,
    user_id: user.id,
    role: 'user',
    content: message,
  })

  const systemPrompt = profileChatSystemPrompt(profile, recentMemos ?? [], roomData.summary)

  const stream = anthropic.messages.stream({
    model: MODEL,
    max_tokens: 1500,
    system: systemPrompt,
    messages: [
      ...historyMessages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      { role: 'user', content: message },
    ],
  })

  const encoder = new TextEncoder()
  const readable = new ReadableStream({
    async start(controller) {
      let fullText = ''
      try {
        for await (const chunk of stream) {
          if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
            fullText += chunk.delta.text
            controller.enqueue(encoder.encode(chunk.delta.text))
          }
        }

        // assistant 메시지 저장 (텍스트가 있을 때만)
        if (fullText) {
          await supabase.from('chat_messages').insert({
            room_id: roomId,
            user_id: user.id,
            role: 'assistant',
            content: fullText,
          })

          // 대화방 메타 업데이트 (제목 자동 생성 포함)
          const isFirstMessage = (roomData.message_count ?? 0) === 0
          const newTitle = isFirstMessage && roomData.title === '새 대화'
            ? (message.length > 28 ? message.slice(0, 28) + '…' : message)
            : roomData.title

          await supabase.from('chat_rooms').update({
            last_message_at: new Date().toISOString(),
            message_count: (roomData.message_count ?? 0) + 2,
            title: newTitle,
          }).eq('id', roomId)

          // 20개 초과 시 자동 요약 (비동기)
          summarizeOldMessages(roomId, user.id, roomData.summary, roomData.message_count ?? 0, supabase).catch(() => {})
        }
      } catch (err) {
        // 스트림 도중 에러 발생 시 에러 메시지를 클라이언트에 전달
        const errMsg = err instanceof Error ? err.message : '알 수 없는 오류'
        controller.enqueue(encoder.encode(`\n\n[오류: ${errMsg}]`))
      } finally {
        controller.close()
      }
    },
  })

  return new Response(readable, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}

async function summarizeOldMessages(
  roomId: string,
  userId: string,
  existingSummary: string | null,
  currentCount: number,
  supabase: Awaited<ReturnType<typeof createClient>>
) {
  if (currentCount < RECENT_WINDOW + 2) return

  const excess = currentCount + 2 - RECENT_WINDOW
  if (excess <= 0) return

  const { data: oldMessages } = await supabase
    .from('chat_messages')
    .select('id, role, content')
    .eq('room_id', roomId)
    .eq('user_id', userId)
    .eq('is_summarized', false)
    .order('created_at', { ascending: true })
    .limit(excess)

  if (!oldMessages?.length) return

  const summaryRes = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 400,
    messages: [{
      role: 'user',
      content: `다음 대화를 핵심만 3~5줄로 요약해줘. 중요한 인사이트, 결정사항, 감정적 맥락 포함:\n\n${oldMessages.map((m) => `${m.role === 'user' ? '나' : 'AI'}: ${m.content}`).join('\n')}`,
    }],
  })
  const newSummary = summaryRes.content[0].type === 'text' ? summaryRes.content[0].text : ''

  const combined = existingSummary ? `${existingSummary}\n\n---\n${newSummary}` : newSummary
  await supabase.from('chat_rooms').update({ summary: combined }).eq('id', roomId)
  await supabase.from('chat_messages').update({ is_summarized: true }).in('id', oldMessages.map((m) => m.id))
}
