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

  let parsed: Record<string, unknown>
  try {
    // assistant 프리필 '{' → Claude가 반드시 JSON 객체로 시작하도록 강제
    const res = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: 'JSON 객체만 반환하세요. 설명, 마크다운, 추가 텍스트 없이 JSON만.',
      messages: [
        {
          role: 'user',
          content: `다음 메모들을 분석해서 사용자 프로필 JSON을 생성해줘.

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
        },
        // 프리필: Claude가 이 텍스트에 이어서 생성 → 반드시 { 로 시작
        { role: 'assistant', content: '{' },
      ],
    })

    const tail = res.content[0].type === 'text' ? res.content[0].text.trim() : ''
    // 프리필 '{' + 나머지 텍스트 = 완전한 JSON
    const jsonText = '{' + tail
    try {
      parsed = JSON.parse(jsonText)
    } catch {
      // 혹시 tail 안에 완전한 JSON이 있을 경우 fallback
      const match = jsonText.match(/\{[\s\S]*\}/)
      if (!match) throw new Error(`파싱 실패. 응답(앞 300자): ${jsonText.slice(0, 300)}`)
      parsed = JSON.parse(match[0])
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : '알 수 없는 오류'
    return NextResponse.json({ error: `AI 응답 파싱 실패: ${msg}` }, { status: 500 })
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
