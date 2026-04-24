import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { anthropic, MODEL } from '@/lib/ai/claude'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: allMemos } = await supabase
    .from('memos')
    .select('title, content_text, tags, folders(name)')
    .eq('user_id', user.id)
    .eq('is_deleted', false)
    .order('created_at', { ascending: false })

  if (!allMemos?.length) {
    return NextResponse.json({ error: '분석할 메모가 없습니다.' }, { status: 400 })
  }

  const memoLines = allMemos.map((m) => {
    const folder = (m.folders as unknown as { name: string } | null)?.name ?? '미분류'
    const tags = (m.tags as string[] | null)?.join(', ') ?? ''
    const preview = (m.content_text ?? '').slice(0, 100)
    return `[${folder}] ${m.title}${tags ? ` | #${tags}` : ''}${preview ? ` | ${preview}` : ''}`
  }).join('\n')

  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1500,
    messages: [{
      role: 'user',
      content: `다음 메모들을 분석해서 사용자 프로필을 JSON으로 생성해줘. 반드시 JSON만 반환 (다른 텍스트 없이):

메모 목록:
${memoLines}

반환 형식:
{
  "interests": ["관심사1", "관심사2"],
  "personality": ["성향1", "성향2"],
  "recurring_themes": ["반복 주제1", "반복 주제2"],
  "values": ["가치관1", "가치관2"],
  "behavior_patterns": ["행동 패턴1", "행동 패턴2"],
  "goals": ["목표1", "목표2"],
  "recent_changes": ["최근 변화1", "최근 변화2"],
  "raw_notes": "자유 형식 분석 메모"
}`,
    }],
  })

  const text = res.content[0].type === 'text' ? res.content[0].text.trim() : ''
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(text)
  } catch {
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return NextResponse.json({ error: 'AI 응답 파싱 실패' }, { status: 500 })
    parsed = JSON.parse(match[0])
  }

  const { data, error } = await supabase
    .from('user_profiles')
    .upsert(
      { user_id: user.id, ...parsed, last_analyzed_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    )
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
