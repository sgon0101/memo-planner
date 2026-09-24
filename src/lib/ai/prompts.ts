/**
 * 이력 대표 메모 섹션 (임베딩 클러스터 대표 — lib/ai/select.ts)
 * "(유사 메모 N개 대표)" 표기가 이미 텍스트에 포함된 상태로 전달된다.
 */
export interface AnalysisScopeOpts {
  /** 전체 이력 클러스터 대표 메모 발췌 (없으면 최근 메모만 사용) */
  representativeTexts?: string[]
  /** 분석이 커버하는 전체 메모 수 (범위 안내용) */
  totalMemos?: number
}

function representativeSection(opts?: AnalysisScopeOpts): string {
  const reps = opts?.representativeTexts ?? []
  if (reps.length === 0) return ''
  const totalNote = opts?.totalMemos ? ` — 전체 ${opts.totalMemos}개 메모의 주제 분포를 요약한 표본` : ''
  return `\n\n## 전체 이력 대표 메모 (주제 클러스터별 대표 ${reps.length}개${totalNote})
${reps.map((t, i) => `${i + 1}. ${t}`).join('\n')}
※ "(유사 메모 N개 대표)"는 해당 주제로 묶인 메모 수입니다. N이 클수록 반복적으로 다뤄온 주제입니다.`
}

export function gapAnalysisPrompt(memoTexts: string[], planTitles: string[], opts?: AnalysisScopeOpts) {
  return `당신은 개인 성장 코치입니다. 사용자의 메모와 플랜 데이터를 분석하여 생각과 행동 사이의 갭을 찾아주세요.

## 최근 메모 (생각/관심사 — 최신 ${Math.min(memoTexts.length, 20)}개)
${memoTexts.slice(0, 20).map((t, i) => `${i + 1}. ${t}`).join('\n')}${representativeSection(opts)}

## 플랜 제목 (실제 행동)
${planTitles.slice(0, 30).map((t, i) => `${i + 1}. ${t}`).join('\n')}

분석 시 최근 메모는 "지금의 관심사", 이력 대표 메모는 "오래 지속된 관심사"로 구분해 반영하세요.
위 데이터를 분석하여 다음 형식으로 JSON만 반환하세요 (다른 텍스트 없이):
{
  "gaps": [
    { "topic": "주제명", "memo": "메모에서 언급된 관심사", "plan": "관련 플랜 유무", "score": 0~100 }
  ],
  "summary": "전체 갭 요약 (2~3문장)",
  "suggestions": ["개선 제안 1", "개선 제안 2", "개선 제안 3"]
}`
}

export function interestAnalysisPrompt(memoTexts: string[], opts?: AnalysisScopeOpts) {
  return `사용자의 메모를 분석하여 관심사 키워드를 추출해주세요.

## 최근 메모 (최신 ${Math.min(memoTexts.length, 20)}개)
${memoTexts.slice(0, 20).map((t, i) => `${i + 1}. ${t}`).join('\n')}${representativeSection(opts)}

count는 표본 내 등장 빈도의 추정치입니다. 이력 대표 메모의 "(유사 메모 N개 대표)" N을 빈도 가중치로 활용하세요.
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

// ─────────────────────────────────────────────────────────────────────────
// 소스 노트 (PDF·이미지 묶음 → 요약 노트)
// ─────────────────────────────────────────────────────────────────────────

/**
 * 입력 종류
 * - pdf        : 텍스트형 PDF (document 블록)
 * - image-pdf  : 이미지형 PDF(웹 캡처·스캔)의 페이지 이미지 타일
 * - images     : 이미지 묶음(긴 캡처·카드뉴스) 타일
 * - chunks     : 긴 세트 분할 추출문(텍스트)을 종합
 */
export type SourceNotePromptKind = 'pdf' | 'image-pdf' | 'images' | 'chunks'

const SOURCE_NOTE_SCHEMA = `{
  "title": "내용을 대표하는 제목 (40자 이내)",
  "oneLiner": "한 문장 요약",
  "keyPoints": ["핵심 요약 3~5개"],
  "sections": [{ "heading": "소제목", "bullets": ["원문 흐름을 따른 정리"] }],
  "concepts": [{ "name": "핵심 개념", "definition": "한두 문장 정의" }],
  "quotes": [{ "text": "기억할 문장 (원문 그대로)", "loc": "위치" }],
  "wikiSuggestions": [{ "name": "개념", "source": "existing | new", "reason": "한 줄 근거" }],
  "tagSuggestions": [{ "name": "분류", "source": "existing | new", "reason": "한 줄 근거" }],
  "textAmount": "rich | some | low"
}`

/**
 * 소스 노트 system 프롬프트 — kind별 고정 문자열이라 prompt cache 대상.
 * 사용자 어휘 목록은 user 메시지로 따로 보낸다.
 */
export function sourceNotePrompt(kind: SourceNotePromptKind): string {
  const inputGuide: Record<SourceNotePromptKind, string> = {
    pdf: '입력은 PDF 문서입니다. 인용 위치(loc)는 "p.12"처럼 쪽 번호로 적으세요.',
    'image-pdf': [
      '입력은 텍스트 레이어가 없는 PDF(웹페이지 캡처·스캔)의 페이지 이미지입니다. 각 이미지 앞에 [p.3 · 조각 1/2] 같은 라벨이 붙어 있습니다.',
      '- 페이지들은 하나의 긴 캡처를 자른 것일 수 있습니다 — 페이지 경계에서 문장이 이어질 수 있으니 자연스럽게 이어 읽으세요.',
      '- 조각은 위아래로 80px씩 겹칩니다 — 겹침 구간의 문장은 한 번만 반영하세요.',
      '- 본문의 작은 글씨, 발표자료·도표의 캡션까지 꼼꼼히 읽으세요.',
      '- 인용 위치(loc)는 "p.12"처럼 쪽 번호로 적으세요.',
    ].join('\n'),
    images: [
      '입력은 이미지 묶음(긴 캡처·카드뉴스 등)입니다. 각 조각 앞에 [이미지 2/5 · 조각 3/7] 같은 라벨이 붙어 있습니다.',
      '- 조각은 위아래로 80px씩 겹칩니다 — 겹침 구간의 문장은 한 번만 반영하세요.',
      '- 이미지 순서대로 하나의 흐름으로 정리하세요. 마지막 조각(하단부) 내용까지 빠짐없이 반영하세요.',
      '- 인용 위치(loc)는 "이미지 2 · 하단"처럼 적으세요.',
    ].join('\n'),
    chunks: [
      '입력은 긴 이미지 세트를 구간별로 옮겨 적은 추출문입니다. [구간 1], [구간 2]… 순서가 원문 순서입니다.',
      '- 구간 경계는 조각 1개씩 겹쳐 있어 같은 문장이 두 번 나올 수 있습니다 — 한 번만 반영하세요.',
      '- 처음부터 마지막 구간까지 전체 흐름을 빠짐없이 정리하세요.',
      '- 인용 위치(loc)는 추출문에 적힌 이미지·페이지 표기를 따르세요.',
    ].join('\n'),
  }

  return [
    '당신은 사용자의 개인 지식 노트 앱의 요약 도우미입니다. 사용자가 올린 자료를 읽고, 나중에 다시 찾아볼 수 있는 한국어 요약 노트 재료를 만듭니다.',
    '반드시 유효한 JSON 객체 하나만 출력하세요. 설명·마크다운·코드블록 없이 raw JSON만.',
    `## 입력\n${inputGuide[kind]}\n- 상태바·버튼·광고·좋아요 수·메뉴 같은 UI 요소는 무시하세요.`,
    `## 출력 스키마\n${SOURCE_NOTE_SCHEMA}`,
    [
      '## 작성 규칙',
      '- 모든 문장은 한국어. 원문이 외국어면 요약은 한국어로, 인용(quotes)은 원문 그대로.',
      '- sections는 원문의 구조·순서를 따르세요. 원문에 없는 내용을 지어내지 마세요.',
      '- quotes는 원문에 실제로 있는 문장만 2~5개.',
      '- textAmount: 이미지에 글자가 거의 없으면 "low", 조금 있으면 "some", 충분하면 "rich".',
    ].join('\n'),
    [
      '## 위키·태그 추천 규칙',
      '- 위키 = 나중에 다시 찾아갈 개념·주제 (명사형, 5~8개). 태그 = 분류·형식·영역 (예: 책, 논문, 카드뉴스, 마케팅 — 3~5개).',
      '- 사용자 어휘 목록에 같은 의미의 표기가 있으면 그 표기를 글자 그대로 재사용하고 source를 "existing"으로.',
      '- 어휘 목록에 없는 새 위키는 최대 3개, source는 "new".',
      '- 위키·태그는 붙여쓰기 ("행동경제학" O, "행동 경제학" X). 태그는 한글·영문·숫자·밑줄만. 위키에 "]" 금지.',
      '- 상위/하위 개념(예: 마케팅 vs 마케팅전략)은 억지로 합치지 마세요.',
      '- reason은 이 자료와의 연관을 한 줄로.',
    ].join('\n'),
  ].join('\n\n')
}

/** 사용자 어휘 목록 + 지시 (user 메시지 마지막 텍스트 블록) */
export function sourceNoteUserText(vocab: { wikis: string[]; tags: string[] }): string {
  return [
    `## 사용자 어휘 목록 — 위키 (사용 횟수)\n${vocab.wikis.length ? vocab.wikis.join(', ') : '(없음)'}`,
    `## 사용자 어휘 목록 — 태그 (사용 횟수)\n${vocab.tags.length ? vocab.tags.join(', ') : '(없음)'}`,
    '위 자료를 스키마에 맞춰 JSON으로 정리하세요.',
  ].join('\n\n')
}

/** 분할 추출(3-3) system — 이미지 속 텍스트를 구조 그대로 옮겨 적는다 (요약 아님) */
export const SOURCE_CHUNK_EXTRACT_SYSTEM = [
  '당신은 이미지 속 텍스트를 옮겨 적는 전사 도우미입니다.',
  '- 이미지 속 글을 구조(제목·소제목·목록·표·캡션) 그대로 마크다운으로 충실히 옮기세요. 요약하지 마세요.',
  '- 조각은 위아래로 80px씩 겹칩니다 — 겹침 구간의 문장은 한 번만 적으세요.',
  '- 상태바·버튼·광고·좋아요 수·메뉴 같은 UI 요소는 제외하세요.',
  '- 각 내용이 어느 이미지·페이지에서 왔는지 라벨을 소제목 옆 괄호로 남기세요 (예: "## 소제목 (이미지 2)" 또는 "(p.3)").',
  '- 마크다운 본문만 출력하세요. 앞뒤 설명 금지.',
].join('\n')
