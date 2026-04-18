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
  return `당신은 사용자의 개인 메모 플래너 AI 어시스턴트입니다. 항상 한국어로 답변하세요.

## 사용자 데이터 컨텍스트
최근 메모 (${memoTexts.length}개):
${memoTexts.slice(0, 10).map((t) => `- ${t}`).join('\n')}

최근 플랜 (${planTitles.length}개):
${planTitles.slice(0, 15).map((t) => `- ${t}`).join('\n')}

사용자의 메모와 플랜 데이터를 바탕으로 개인화된 조언과 인사이트를 제공하세요. 데이터에 기반한 구체적인 제안을 해주세요.`
}
