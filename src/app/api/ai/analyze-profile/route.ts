import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { anthropic, HAIKU_MODEL } from '@/lib/ai/claude'
import { checkRateLimit } from '@/lib/security/rateLimit'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 24h 이내 분석 이력 있으면 기존 결과 반환
  const { data: existing } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('user_id', user.id)
    .single()

  if (existing?.last_analyzed_at) {
    const lastAt = new Date(existing.last_analyzed_at).getTime()
    const hoursPassed = (Date.now() - lastAt) / (1000 * 60 * 60)
    if (hoursPassed < 24) {
      return NextResponse.json({ ...existing, cached: true })
    }
  }

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

  // 일일 호출 한도 — 24h 캐시 히트는 위에서 이미 반환됐으므로 실제 AI 호출에만 카운트
  const rate = await checkRateLimit(supabase, 'ai-analyze-profile')
  if (!rate.ok) return NextResponse.json({ error: rate.message }, { status: 429 })

  let parsed: Record<string, unknown>
  try {
    const res = await anthropic.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 4096,
      system: 'You must respond with only a valid JSON object. No explanation, no markdown, no code blocks — raw JSON only.',
      messages: [{
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
      }],
    })

    const raw = res.content[0].type === 'text' ? res.content[0].text.trim() : ''
    console.log('[analyze-profile] raw response:', raw.slice(0, 500))
    parsed = extractJSON(raw)
  } catch (err) {
    const msg = err instanceof Error ? err.message : '알 수 없는 오류'
    console.error('[analyze-profile] error:', msg)
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

function extractJSON(text: string): Record<string, unknown> {
  // 1. 그대로 파싱 시도
  try { return JSON.parse(text) } catch {}

  // 2. 마크다운 코드블록 안의 JSON 추출 (어디든 위치 무관)
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (codeBlock) {
    try { return JSON.parse(codeBlock[1].trim()) } catch {}
  }

  // 3. 첫 번째 { ~ 마지막 } 추출
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start !== -1 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)) } catch {}
  }

  // 진단용: 실제 응답 앞 400자를 에러 메시지에 포함
  throw new Error(`JSON 없음. 실제응답: "${text.slice(0, 400)}"`)
}
