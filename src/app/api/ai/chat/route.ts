import { NextRequest } from 'next/server'
import { format, startOfWeek, endOfWeek } from 'date-fns'
import { createClient } from '@/lib/supabase/server'
import { anthropic, HAIKU_MODEL } from '@/lib/ai/claude'
import { profileChatSystemPrompt, type ChatContextExtras } from '@/lib/ai/prompts'
import { embedText } from '@/lib/ai/embeddings'
import { checkRateLimit } from '@/lib/security/rateLimit'

export const maxDuration = 60 // Vercel Pro: 최대 60초 스트리밍 허용

const RECENT_WINDOW = 20
/** RAG — 질문과 의미 유사한 메모를 컨텍스트에 주입 */
const RAG_MATCH_COUNT = 4
const RAG_THRESHOLD = 0.3
const RAG_SNIPPET_LEN = 500

type SupabaseServer = Awaited<ReturnType<typeof createClient>>

/**
 * 질문을 임베딩해 의미적으로 관련된 메모 본문 발췌를 가져온다 (RAG).
 * 실패해도 채팅은 정상 진행 — fail-open.
 * 잠금 메모는 match 결과에서 제외 (본문 재조회 시 is_locked 필터).
 */
async function fetchRelatedMemoSnippets(
  supabase: SupabaseServer,
  userId: string,
  message: string,
): Promise<{ title: string; snippet: string }[]> {
  try {
    const queryEmbedding = await embedText(message)
    const { data: matches } = await supabase.rpc('match_memos', {
      query_embedding: queryEmbedding,
      match_threshold: RAG_THRESHOLD,
      match_count: RAG_MATCH_COUNT,
      exclude_id: null,
      user_id_filter: userId,
    })
    const ids = ((matches ?? []) as { id: string }[]).map((m) => m.id)
    if (ids.length === 0) return []

    const { data: rows } = await supabase
      .from('memos')
      .select('id, title, content_text, is_locked')
      .in('id', ids)
      .eq('is_locked', false)
    if (!rows?.length) return []

    // match 유사도 순서 유지
    const order = new Map(ids.map((id, i) => [id, i]))
    return rows
      .slice()
      .sort((a, b) => (order.get(a.id) ?? 99) - (order.get(b.id) ?? 99))
      .map((r) => ({
        title: r.title || '제목 없음',
        snippet: (r.content_text ?? '').slice(0, RAG_SNIPPET_LEN),
      }))
      .filter((r) => r.snippet)
  } catch (e) {
    // 임베딩 실패(키 미설정 등)는 조용히 건너뜀 — 채팅 본 흐름 방해 금지
    console.warn('[ai/chat] RAG skip:', e instanceof Error ? e.message : e)
    return []
  }
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const { roomId, message } = await req.json()
  if (!roomId || !message) return new Response('Bad Request', { status: 400 })
  if (typeof message !== 'string' || message.length > 4000) {
    return new Response('메시지가 너무 깁니다. (최대 4,000자)', { status: 400 })
  }

  // 일일 호출 한도 (사용자별)
  const rate = await checkRateLimit(supabase, 'ai-chat')
  if (!rate.ok) return new Response(rate.message, { status: 429 })

  // 이번 주 범위 (월요일 시작 — 앱 플래너 기준과 동일)
  const now = new Date()
  const weekStart = format(startOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd')
  const weekEnd = format(endOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd')

  // user_profile + 메모/플랜 컨텍스트 + RAG 병렬 로드
  const [
    { data: profile },
    { data: recentMemos },
    { data: roomData },
    { data: history },
    { data: weekPlansRaw },
    { data: recentPlansRaw },
    relatedMemos,
  ] = await Promise.all([
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
      .eq('is_locked', false) // 잠금 메모는 AI 컨텍스트에서 제외 (그래프 분석과 동일 규칙)
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
    supabase
      .from('plans')
      .select('title, date, is_completed')
      .eq('user_id', user.id)
      .gte('date', weekStart)
      .lte('date', weekEnd)
      .order('date', { ascending: true })
      .limit(30),
    supabase
      .from('plans')
      .select('title, date, is_completed')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(15),
    fetchRelatedMemoSnippets(supabase, user.id, message),
  ])

  if (!roomData) return new Response('Room not found', { status: 404 })

  const toPlanRow = (p: { title: string; date: string | null; is_completed: boolean }) => ({
    title: p.title,
    date: p.date,
    isCompleted: p.is_completed,
  })
  // relatedMemos(RAG)는 질문마다 달라지므로 캐시 블록(systemPrompt)에서 분리
  // — 프로필/메모/플랜 컨텍스트의 prompt cache 히트율 유지
  const extras: ChatContextExtras = {
    weekPlans: (weekPlansRaw ?? []).map(toPlanRow),
    recentPlans: (recentPlansRaw ?? []).map(toPlanRow),
  }
  const ragBlock = relatedMemos.length > 0
    ? `## 사용자의 질문과 관련된 메모 본문 발췌\n${relatedMemos.map((m) => `### ${m.title}\n${m.snippet}`).join('\n\n')}\n\n(위 발췌를 우선 근거로 답변하세요)`
    : null

  // 최근 메시지 시간순 정렬
  const historyMessages = (history ?? []).reverse()

  // 사용자 메시지 저장 — 스트림 시작을 막지 않도록 백그라운드로 시작
  // (assistant 메시지 저장 전에 await → created_at 순서 보장)
  const userInsertPromise = Promise.resolve(
    supabase.from('chat_messages').insert({
      room_id: roomId,
      user_id: user.id,
      role: 'user',
      content: message,
    })
  )

  const systemPrompt = profileChatSystemPrompt(profile, recentMemos ?? [], roomData.summary, extras)

  const stream = anthropic.messages.stream({
    model: HAIKU_MODEL,
    max_tokens: 2048,  // 800 → 2048: 답변이 중간에 잘리던 이슈 해결 (한국어 800 토큰 ≈ 400~500자로 부족)
    messages: [
      ...historyMessages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      {
        role: 'user',
        content: [
          // 시스템 컨텍스트를 캐시 블록으로 → 동일 세션 반복 호출 시 입력 토큰 절감
          { type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } },
          // RAG 발췌는 질문마다 달라지므로 캐시 블록 뒤에 별도 배치
          ...(ragBlock ? [{ type: 'text' as const, text: ragBlock }] : []),
          { type: 'text', text: message },
        ],
      },
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
          await userInsertPromise // user 메시지가 먼저 저장되도록 보장
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
        // 스트림 도중 에러 — raw 메시지는 서버 로그로, 사용자에게는 정돈된 안내만
        console.error('[ai/chat] stream error:', err instanceof Error ? err.message : err)
        controller.enqueue(encoder.encode('\n\n⚠️ 응답 생성 중 문제가 발생했어요. 잠시 후 다시 시도해주세요.'))
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
    model: HAIKU_MODEL,
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
