export function gapAnalysisPrompt(memoTexts: string[], planTitles: string[]) {
  return `당신은 개인 성장 코치입니다. 사용자의 메모와 플랜 데이터를 분석하여 생각과 행동 사이의 갭을 찾아주세요.

## 메모 내용 (생각/관심사)
${memoTexts.slice(0, 20).map((t, i) => `${i + 1}. ${t}`).join('\n')}

## 플랜 제목 (실제 행동)
${planTitles.slice(0, 30).map((t, i) => `${i + 1}. ${t}`).join('\n')}

위 데이터를 분석하여 다음 형식으로 JSON만 반환하세요 (다른 텍스트 없이):
{
  "gaps": [
    { "topic": "주제명", "memo": "메모에서 언급된 관심사", "plan": "관련 플랜 유무", "score": 0~100 }
  ],
  "summary": "전체 갭 요약 (2~3문장)",
  "suggestions": ["개선 제안 1", "개선 제안 2", "개선 제안 3"]
}`
}

export function interestAnalysisPrompt(memoTexts: string[]) {
  return `사용자의 메모를 분석하여 관심사 키워드를 추출해주세요.

## 메모 내용
${memoTexts.slice(0, 20).map((t, i) => `${i + 1}. ${t}`).join('\n')}

다음 형식으로 JSON만 반환하세요 (다른 텍스트 없이):
{
  "interests": [
    { "keyword": "키워드", "count": 출현빈도, "category": "카테고리명" }
  ],
  "topCategory": "가장 많이 등장하는 카테고리"
}`
}

export function retroReportPrompt(
  period: string,
  memoCount: number,
  completedPlans: number,
  totalPlans: number,
  topTags: string[],
  memoTexts: string[],
) {
  return `당신은 개인 성장 분석가입니다. 사용자의 ${period} 데이터를 바탕으로 회고 리포트를 작성해주세요.

## 통계
- 작성한 메모: ${memoCount}개
- 완료한 플랜: ${completedPlans}/${totalPlans}개 (${totalPlans > 0 ? Math.round(completedPlans / totalPlans * 100) : 0}%)
- 자주 쓴 태그: ${topTags.join(', ') || '없음'}

## 주요 메모 내용 (최근 10개)
${memoTexts.slice(0, 10).map((t, i) => `${i + 1}. ${t}`).join('\n')}

다음 형식으로 JSON만 반환하세요 (다른 텍스트 없이):
{
  "headline": "이 기간을 한 문장으로",
  "achievements": ["성취 1", "성취 2", "성취 3"],
  "improvements": ["개선점 1", "개선점 2"],
  "nextGoals": ["다음 목표 1", "다음 목표 2", "다음 목표 3"],
  "encouragement": "격려 메시지 (2~3문장)"
}`
}

export function chatSystemPrompt(memoTexts: string[], planTitles: string[]) {
  return `당신은 사용자의 개인 Weave AI 어시스턴트입니다. 항상 한국어로 답변하세요.

## 사용자 데이터 컨텍스트
최근 메모 (${memoTexts.length}개):
${memoTexts.slice(0, 10).map((t) => `- ${t}`).join('\n')}

최근 플랜 (${planTitles.length}개):
${planTitles.slice(0, 15).map((t) => `- ${t}`).join('\n')}

사용자의 메모와 플랜 데이터를 바탕으로 개인화된 조언과 인사이트를 제공하세요. 데이터에 기반한 구체적인 제안을 해주세요.`
}

type Profile = {
  interests?: string[]
  personality?: string[]
  recurring_themes?: string[]
  values?: string[]
  behavior_patterns?: string[]
  goals?: string[]
  recent_changes?: string[]
  raw_notes?: string
} | null

type MemoRow = { title: string; content_text: string | null; tags: string[] | null; folders: { name: string } | { name: string }[] | null }

export interface ChatPlanRow {
  title: string
  date: string | null
  isCompleted: boolean
}

export interface ChatContextExtras {
  /** 이번 주 플랜 (제목 + 날짜 + 완료 여부) */
  weekPlans?: ChatPlanRow[]
  /** 최근 생성 플랜 */
  recentPlans?: ChatPlanRow[]
  /** 사용자 질문과 의미적으로 관련된 메모 본문 발췌 (RAG) */
  relatedMemos?: { title: string; snippet: string }[]
}

export function profileChatSystemPrompt(
  profile: Profile,
  recentMemos: MemoRow[],
  conversationSummary: string | null,
  extras?: ChatContextExtras,
) {
  const profileSection = profile
    ? `## 사용자 프로필
관심사: ${(profile.interests ?? []).join(', ') || '미설정'}
성향: ${(profile.personality ?? []).join(', ') || '미설정'}
반복 주제/고민: ${(profile.recurring_themes ?? []).join(', ') || '미설정'}
가치관: ${(profile.values ?? []).join(', ') || '미설정'}
행동 패턴: ${(profile.behavior_patterns ?? []).join(', ') || '미설정'}
목표: ${(profile.goals ?? []).join(', ') || '미설정'}
최근 변화: ${(profile.recent_changes ?? []).join(', ') || '미설정'}${profile.raw_notes ? `\n메모: ${profile.raw_notes}` : ''}`
    : ''

  const summarySection = conversationSummary
    ? `## 이전 대화 요약\n${conversationSummary}`
    : ''

  const memoSection = recentMemos.length > 0
    ? `## 최근 메모 (최신 ${recentMemos.length}개)\n${recentMemos.map((m) => {
        const folderObj = Array.isArray(m.folders) ? m.folders[0] : m.folders
        const folder = (folderObj as { name: string } | null)?.name ?? '미분류'
        const tags = (m.tags as string[] | null)?.join(', ') ?? ''
        return `- [${folder}] ${m.title}${tags ? ` #${tags}` : ''}`
      }).join('\n')}`
    : ''

  const fmtPlan = (p: ChatPlanRow) =>
    `- ${p.isCompleted ? '[완료]' : '[미완료]'} ${p.title}${p.date ? ` (${p.date})` : ''}`

  const weekPlans = extras?.weekPlans ?? []
  const weekCompleted = weekPlans.filter((p) => p.isCompleted).length
  const weekPlanSection = weekPlans.length > 0
    ? `## 이번 주 플랜 (${weekPlans.length}개 중 ${weekCompleted}개 완료 — 달성률 ${Math.round((weekCompleted / weekPlans.length) * 100)}%)\n${weekPlans.map(fmtPlan).join('\n')}`
    : ''

  const recentPlans = extras?.recentPlans ?? []
  const recentPlanSection = recentPlans.length > 0
    ? `## 최근 플랜 (최신 ${recentPlans.length}개)\n${recentPlans.map(fmtPlan).join('\n')}`
    : ''

  const relatedMemos = extras?.relatedMemos ?? []
  const relatedSection = relatedMemos.length > 0
    ? `## 사용자의 질문과 관련된 메모 본문 발췌\n${relatedMemos.map((m) => `### ${m.title}\n${m.snippet}`).join('\n\n')}`
    : ''

  return [
    '당신은 사용자의 개인 AI 어시스턴트입니다. 메모, 플랜, 대화 기록을 기반으로 깊이 있는 인사이트를 제공합니다. 항상 한국어로 답변하세요.',
    profileSection,
    summarySection,
    memoSection,
    weekPlanSection,
    recentPlanSection,
    relatedSection,
    '## 답변 원칙\n- 사용자의 실제 데이터(메모·플랜)를 구체적으로 언급하세요\n- 관련 메모 발췌가 주어지면 그 내용을 우선 근거로 삼으세요\n- 일반적인 조언보다 사용자 맞춤 인사이트를 제공하세요\n- 패턴과 변화를 발견하면 적극적으로 공유하세요\n- 따뜻하고 솔직하게 대화하세요',
  ].filter(Boolean).join('\n\n')
}
