# [3/3] 소스(PDF·긴 이미지 묶음) → 요약 노트 자동 생성 + 맞춤 위키·태그 추천 + 그래프 연결

> 1단계(정규화)·2단계(소스 파일 인프라) 커밋 완료 후 진행. 같은 `feat/pdf-note` 브랜치.

## 0. 사전 점검 (필수)

1. `git status` clean + 브랜치 `feat/pdf-note` + 최근 커밋 2개가 1·2단계인지 확인. 아니면 멈추고 보고.
2. 존재 확인: `src/lib/wiki/normalize.ts`, `uploadSources`, `/api/files/*`, `SourceFileBar`, `memo_sources` 테이블, `uploaded_files.is_source/image_width/image_height/page_count`.
3. 재사용할 기존 코드: `src/lib/ai/claude.ts`(MODEL = claude-sonnet-4-6), `src/lib/security/rateLimit.ts`, `src/lib/ai/embeddings.ts`, `match_memos` RPC(`/api/memos/[id]/related`), `src/components/ui/Modal.tsx`, vaul Bottom Sheet 패턴, `ToastProvider`, `memoKeys`(`useMemos.ts`).

## 1. 확정된 설계 (변경 금지)

- **소스 1세트 → 요약 노트 1개.** 소스 세트 = PDF 1개 **또는** 이미지 1~20장(카드뉴스·연속 캡처를 한 덩어리로). 개념 노트는 만들지 않는다 — Weave에선 `[[개념]]` 허브가 곧 개념 노드.
- 모델 **Sonnet 4.6**. 파이프라인은 하나, **입력 어댑터만 2개**(PDF / 이미지 타일). **텍스트 레이어 없는 PDF(캡처·스캔)는 페이지 이미지를 꺼내 이미지 어댑터로 보낸다.** 이미지 입력은 항상 **여백 자동 크롭 → 타일** 순서.
- **저장은 원본 그대로, 가공은 분석 순간에만** — 크롭·타일 등 가공물은 저장하지 않는다.
- PDF 1차 한도 **100쪽**. 이미지 세트 한도 **총 타일 150개**(아래 규칙) — 타일 40개 초과 세트는 **분할 추출 → 종합** 2단계로 처리.
- **사용자 검토 후 생성**: AI 결과는 모달에서 확인·수정 후에만 메모가 된다.
- **본문에 `[[ ]]`와 `#태그`를 리터럴로 기록** — 에디터가 저장 시 본문에서 wiki_links/tags를 재추출하므로, 본문에 없으면 첫 편집에 링크가 사라진다.

## 2. DB 마이그레이션 (다음 번호)

```sql
-- 소스 세트 분석 캐시 (같은 세트 재분석 방지)
CREATE TABLE IF NOT EXISTS source_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_key text NOT NULL,          -- sha256(kind + ':' + 순서대로 이어붙인 content_hash들)
  kind text NOT NULL CHECK (kind IN ('pdf', 'images')),
  file_ids uuid[] NOT NULL,          -- 순서 보존
  analysis jsonb NOT NULL,
  usage jsonb,                       -- input/output/cache 토큰 (비용 추적)
  created_at timestamptz DEFAULT now(),
  UNIQUE (user_id, source_key)
);
ALTER TABLE source_analyses ENABLE ROW LEVEL SECURITY;  -- 본인만
```
- 이미지 **순서가 바뀌면 다른 세트**(요약 흐름이 달라지므로).
- 기존 스타일(헤더 주석 + DO 검증) → 적용 → CLAUDE.md 기록.
- `increment_api_usage`가 임의 버킷명을 받는지 확인 후 `RATE_LIMITS`에 `'ai-source-note': 20` 추가.

## 3. 입력 어댑터 — `src/lib/source-note/`

### 3-0. 원칙 — 저장은 원본, 가공은 분석 순간에만
- 아래의 텍스트 검사·페이지 이미지 추출·여백 크롭·타일 분할은 **전부 분석 요청 처리 중 서버 메모리에서만** 일어난다. R2 원본·`uploaded_files`는 절대 변경하지 않고, 가공 결과물(크롭 이미지·타일)도 저장하지 않는다. 다운로드는 항상 업로드한 원본과 바이트 동일.

### 3-1. PDF (`pdfInput.ts`) — 텍스트형 / 이미지형 분기
실제 사용 사례: 웹페이지 전체 캡처 확장(jsPDF)으로 만든 PDF는 **텍스트 레이어가 0자**이고 페이지마다 JPEG 1장(1920×2524)뿐이다. 본문 칼럼은 폭의 35%(620~1295px)라, PDF를 그대로 넘기면 Claude가 페이지를 1568px로 축소하면서 본문이 약 420px로 줄어 작은 글씨가 흐려진다.
```
① npm i unpdf (서버리스용 pdf.js 빌드) → 페이지별 텍스트 추출
② 판정: 평균 30자/페이지 이상 → '텍스트형'   미만 → '이미지형'
③ 텍스트형 → { type:'document', source:{ type:'url', url: publicUrl } } 그대로 (기존 방식)
④ 이미지형 → pdf-lib로 페이지마다 가장 큰 이미지 XObject를 찾아
     필터가 DCTDecode(JPEG)면 스트림 바이트 = JPEG 원본 그대로 추출
   · 모든 페이지 추출 성공 → 페이지 이미지 N장을 '이미지 세트'로 간주해 3-2 파이프라인(크롭 → 타일)으로
   · 하나라도 실패(JBIG2/CCITT/Flate 등 스캔 포맷, 페이지에 여러 이미지 조합) → ③ 방식으로 폴백 + 로그 'image-pdf-fallback'
```
- 이미지형 PDF의 페이지 이미지들은 **연속된 한 장의 긴 캡처를 자른 것**일 수 있으므로, 타일 라벨은 `[p.3 · 조각 1/2]` 형식으로 붙이고 프롬프트에 "페이지 경계에서 문장이 이어질 수 있다"고 명시.
- 인용 위치(`loc`)는 이미지형 PDF도 `p.N`으로.
- URL document 방식에서 URL fetch 실패 시 **1회만** base64 폴백(32MB 이하). SDK(0.90)의 URL document 타입 확인.

### 3-2. 이미지 타일 (`tileImage.ts`) — 긴 이미지가 이 기능의 핵심 난관
Claude 비전은 긴 변 1568px / 약 1.15MP 초과 시 자동 축소, 8000px 초과 시 거부 → **긴 캡처를 그대로 넣으면 글자를 못 읽는다.** 서버에서 sharp로 분할:
```
1) R2에서 원본 fetch (서버 outbound라 4.5MB 제한 무관) — 이미지형 PDF는 3-1에서 추출한 페이지 JPEG
2) 여백 자동 크롭 (cropMargins.ts, 아래 규칙) — 본문 칼럼만 남김
3) 가로 > 1568 이면 가로 1568로 축소 (비율 유지)
4) 타일 높이 = min(1568, floor(1_150_000 / 가로)), 겹침 80px
   세로가 타일 높이 이하면 분할 없이 1장
5) 각 타일 JPEG q85로 인코딩 → base64
6) 순서대로: {type:'text', text:'[이미지 2/5 · 조각 3/7]'} + {type:'image', ...}
```
**여백 자동 크롭 규칙 (`cropMargins.ts`)** — 데스크톱 웹 캡처는 좌우 회색·흰 여백이 폭의 50~65%를 차지한다.
```
a) sharp → greyscale raw. 행은 4px 간격 샘플링(속도)
b) 각 행의 배경색 = 그 행 양 끝 16px의 중앙값
c) 열(column)마다 '배경과 |차이| > 20'인 샘플 행의 비율을 계산
d) 비율 > 1.5% 인 열 = 콘텐츠 열 → 가장 왼쪽/오른쪽 콘텐츠 열 = [x0, x1]
   (1.5% 문턱: 페이지 폭 전체를 덮는 상단 배너·푸터처럼 몇 줄뿐인 요소에 끌려가지 않게)
e) 좌우 24px 패딩 추가
f) 크롭 조건: (x1-x0) ≤ 원본 폭의 85% AND (x1-x0) ≥ 320px 일 때만. 아니면 원본 유지
g) 세트(같은 PDF의 페이지들 / 같은 묶음의 이미지들) 안에서 크롭 폭이 비슷하면(±10%) 합집합 범위로 통일 — 페이지마다 글자 크기가 들쭉날쭉해지지 않게
```
- 세로(상하) 크롭은 하지 않는다 (타일 순서·위치 라벨이 어긋남).
- 크롭 결과 `{ x0, x1, cropped: boolean }`를 분석 결과 `usage` 옆에 기록(디버깅용).
- 실측 기대값: 위 jsPDF 캡처 페이지(1920×2524) → 약 x0=596, x1=1319 (본문 675px + 패딩). 크롭 후 가로 723px → 페이지당 2타일, 원본 해상도 유지.

- 순수 함수로 **타일 좌표 계산**(`computeTiles(width, height)`)을 분리 — 클라이언트 사전검사에서도 같은 함수 사용(한도 판정 일치).
- 세트 총 타일 > 150 → 거부(클라이언트에서 먼저 차단). 한 요청의 base64 합계 > 25MB면 q70으로 재인코딩.
- 실측 기준(사용자 실제 사용 사례): 비율 1:18 캡처(1080×19,600) ≈ 20타일, 비율 1:31 캡처(1080×33,200) ≈ 34타일 → 2장 묶음 54타일. 1440px 폭이면 99타일까지 늘어남 → **60 같은 낮은 상한은 실사용을 막는다.**
- sharp `limitInputPixels`를 약 1.5억 px(예: 2160×70000)까지 허용, 타일마다 `extract` 후 즉시 해제(메모리). 이미지별로 순차 처리해 동시 메모리 상한 유지.
- 예시 비용 감: 1080×18000 1장 ≈ 17타일 ≈ 입력 2.6만 토큰 ≈ $0.08 / 54타일 묶음 ≈ 8.3만 토큰 ≈ $0.3.

### 3-3. 긴 세트 분할 처리 (`chunkedExtract.ts`) — 타일 > 40
```
① 타일을 순서대로 최대 30개씩 청크로 나눔 (청크 경계도 겹침 타일 1개 공유)
② 청크별 '추출' 호출(병렬 최대 3, Sonnet, max_tokens 4000):
   이미지 속 텍스트를 구조 그대로 충실히 옮기되 UI 요소 제거 → { chunkIndex, headings[], body(markdown) }
③ '종합' 호출: 청크 추출문을 순서대로 이어 붙인 텍스트 + 어휘 목록 → 4-3 스키마 JSON (이미지 없이 텍스트만이라 저렴)
```
- 전체가 `maxDuration` 안에 끝나도록 청크 병렬 처리. 실패한 청크는 1회 재시도, 그래도 실패하면 분석 전체를 에러로(부분 요약 금지 — 누락을 모른 채 노트가 생기는 게 최악).
- 청크 추출문은 `source_analyses.analysis.extracted`에 함께 저장 → [다시 분석] 시 추출은 재사용하고 종합만 재호출(비용 절감).

## 4. 분석 API — `POST /api/ai/source-note/analyze`

- `runtime = 'nodejs'`, `maxDuration = 300` (Vercel 플랜 한도 초과 경고가 나는지 확인·보고).
- 입력 `{ fileIds: string[] (순서대로), force?: boolean }` → 본인 `uploaded_files`(is_source) 조회, 형식 혼합·개수 검증, `source_key` 계산.
- **캐시**: `source_analyses` 히트 + `force` 아님 → 그대로 반환(한도 차감·AI 호출 없음). 캐시 미스일 때만 `checkRateLimit(supabase, 'ai-source-note')`.

### 4-1. 컨텍스트
- **어휘 목록**: 사용자 전체 메모(삭제 제외)의 wiki_links·tags를 `buildCanonicalMap`으로 대표 표기화 + 사용 횟수 → 상위 **wiki 300 / tag 150**을 `행동경제학(12)` 형식으로.
- 잠금 메모(`is_locked`) 내용은 절대 넣지 않는다.

### 4-2. Claude 호출
- `messages.create({ model: MODEL, max_tokens: 8000, system: [{ type:'text', text: SYSTEM, cache_control:{ type:'ephemeral' } }], messages:[{ role:'user', content:[ ...어댑터 블록, { type:'text', text: 어휘목록 + 지시 } ] }] })`
- 프롬프트는 `src/lib/ai/prompts.ts`에 `sourceNotePrompt(kind)`로 추가. **순수 JSON만**(기존 insights 라우트 system 문구 패턴), 한국어.
- 이미지 전용 지시: "조각은 80px씩 겹친다 — 겹침 구간 문장은 한 번만", "이미지 순서대로 하나의 흐름으로 정리", "UI 요소(상태바·버튼·광고·좋아요 수)는 무시".

### 4-3. 응답 스키마 (`src/lib/source-note/types.ts`)
```ts
interface SourceNoteAnalysis {
  title: string                 // 내용을 대표하는 제목
  oneLiner: string
  keyPoints: string[]           // 3~5
  sections: { heading: string; bullets: string[] }[]
  concepts: { name: string; definition: string }[]
  quotes: { text: string; loc?: string }[]   // PDF: "p.12" / 이미지: "이미지 2 · 하단"
  wikiSuggestions: { name: string; source: 'existing' | 'new'; reason: string }[]
  tagSuggestions:  { name: string; source: 'existing' | 'new'; reason: string }[]
  textAmount: 'rich' | 'some' | 'low'        // 이미지에 글자가 거의 없으면 low
}
```
프롬프트 규칙:
- 위키 = 다시 찾아갈 **개념·주제**(명사형, 5~8개). 태그 = **분류·형식·영역**(예: 책/논문/카드뉴스/마케팅, 3~5개).
- **어휘 목록에 같은 의미가 있으면 그 표기를 그대로 재사용**(`existing`). 새 위키 최대 3개.
- 위키·태그 **붙여쓰기**(기존 컨벤션). 태그는 `[\w가-힣]`만, 위키에 `]` 금지.
- 상위/하위 개념(마케팅 vs 마케팅전략)은 억지로 합치지 않는다. `reason`은 한 줄 근거.

### 4-4. 서버 후처리 (프롬프트를 믿지 않는다)
1. 모든 위키/태그 `resolveToCanonical` → 치환되면 `source='existing'`으로 교정.
2. 태그 불가 문자 제거, 빈 값·키 기준 중복 제거, `new` 위키 3개 초과분 제거.
3. **이웃 기반 추천**: `oneLiner + keyPoints` 임베딩 → `match_memos`로 유사 메모 상위 5개(잠금·삭제 제외, 임계값은 related 라우트와 동일) → 그들의 wiki를 대표 표기로 모아 **2개 이상 메모에서 등장**하거나 concepts와 키가 겹치면 `source:'neighbor'` + `neighborCount` 추가(중복 skip). 실패는 fail-open.
4. 유사 메모 `{ id, title, similarity }[]` 반환(노트 "연결된 메모" 섹션용).
5. `source_analyses`에 저장(`usage` 포함), PDF면 `page_count` 갱신. `usage`는 콘솔에도 기록.

## 5. 생성 API — `POST /api/ai/source-note/create`

- 입력: `{ sourceAnalysisId, folderId, title, wikis: string[], tags: string[], includeRelated: boolean }`
- 캐시된 분석으로 본문 생성 — **AI 재호출·한도 차감 없음**. 위키/태그는 서버에서 다시 `resolveToCanonical`.
- 본문 빌더 `src/lib/source-note/buildNoteDoc.ts`: **Tiptap JSON 직접 생성**(`fromMarkdown`은 인라인 서식/링크 미지원):
  ```
  (blockquote) 📄 원본: {파일명} · {N}쪽 · {YYYY-MM-DD}
               🖼 원본: 이미지 {N}장 ({첫 파일명} 외 {N-1}장) · {YYYY-MM-DD}
  ## 한 줄 요약      — paragraph
  ## 핵심 요약       — bulletList
  ## 내용 정리       — sections마다 ### heading + bulletList
  ## 핵심 개념       — "[[개념]] — 정의" (확정 위키에 포함된 개념만 [[ ]], 나머지 평문)
  ## 기억할 문장     — blockquote들 (+ " — {loc}")
  ## 연결된 메모     — includeRelated일 때만, 없으면 섹션 생략
  (paragraph) 연결: [[위키1]] [[위키2]] …   ← 확정 위키 전체
  (paragraph) #태그1 #태그2 …
  ```
  - 원본 이미지는 **본문에 삽입하지 않는다** (긴 이미지가 노트를 뒤덮음) — SourceFileBar가 담당.
  - 기존 메모 JSON 샘플 1개와 노드 구조 비교(StarterKit·`CustomEnterExtension` 호환).
  - `content_text`는 블록 텍스트를 `\n`으로 연결. **`wiki_links`/`tags`는 이 content_text에서 MemoEditor와 동일한 정규식으로 추출한 값을 저장**(첫 편집 후에도 불변 보장).
- insert(`memos`, RLS 사용자 컨텍스트) → `memo_sources`에 파일들 `position` 순서로 insert → 각 `uploaded_files.memo_id`가 null이면 새 메모 id로 채움(호환용) → 임베딩 즉시 생성(실패 무시).
- 반환 `{ memoId }`.

## 6. UI

### 6-1. 진입점 — `MemoList.tsx`
- 헤더 `+ 새 메모` 옆 보조 버튼 `파일로 노트` (lucide `FileUp`, violet 아웃라인). 현재 `selectedFolderId`를 기본 폴더로. 휴지통 뷰에선 숨김.
- 파일 선택: `accept="application/pdf,image/png,image/jpeg,image/webp"`, `multiple`.
- 데스크톱 드래그앤드롭: 메모 목록 영역, `dataTransfer.types.includes('Files')`일 때만(폴더 패널 메모 이동 드롭과 충돌 금지). 오버레이 "PDF나 이미지를 놓으면 요약 노트를 만들어요".

### 6-2. `src/components/memo/SourceNoteModal.tsx` (상태 머신)
```
select → precheck → arrange(이미지 2장+) → uploading(%) → analyzing → review → creating → 완료
                                            ↘ duplicate           ↘ error(재시도)
```
- **precheck**(클라이언트): PDF는 `pdf-lib`(동적 import, `npm i pdf-lib`)로 쪽수 ≤100 / 이미지는 **파일 헤더 파싱으로 치수만 읽기**(PNG IHDR / JPEG SOF / WebP VP8 — 세로 3만px 넘는 이미지는 모바일에서 `createImageBitmap` 디코딩이 실패·메모리 폭주할 수 있으므로 전체 디코딩 금지) → `computeTiles` 합계 ≤150, 개수 ≤20, 크기 한도, PDF·이미지 혼합 금지, HEIC 안내. 실패 사유는 구체적으로("총 조각 162개 — 150개 이하로 줄여주세요, 가장 긴 이미지: xxx.png"). 타일 40개 초과면 "긴 이미지라 1~3분 걸려요" 안내.
- **arrange**(이미지 2장 이상): 썸네일 그리드 + 드래그 재정렬. 기본 순서 = **파일명 자연 정렬**(`localeCompare(..., { numeric: true })` — 캡처 파일명이 시간순이라). 개별 제외(×) 가능.
- **duplicate**: 세트의 모든 파일이 **같은 기존 노트**에 연결돼 있으면 "이 파일들로 만든 노트가 이미 있어요" [노트 열기] (휴지통이면 안내). 일부만 다른 노트에 쓰였으면 막지 않고 칩으로 "다른 노트에도 쓰임" 표시.
- **analyzing**: "30~90초 걸려요" + 단계 문구 순환(읽는 중 → 구조 정리 → 개념 연결). 모달을 닫아도 요청 유지, 완료 시 토스트 "분석 완료 — 확인하기"(액션)로 재오픈(서버 캐시라 재호출 비용 없음).
- **review**:
  - `textAmount === 'low'`면 상단 경고 "글자가 거의 없는 이미지예요 — 요약 품질이 낮을 수 있어요".
  - 제목(편집), 한 줄 요약·핵심 요약 미리보기(접기/펼치기)
  - 위키/태그 칩: 🔵 기존(`existing`) · 🟣 새로 만듦(`new`) · 🩵 비슷한 메모 N개(`neighbor`, **기본 해제**). 탭=토글, 길게/우클릭=이름 수정, `+ 추가`(1단계 자동완성 재사용, 입력값 정규화). 칩 hover/탭 시 `reason`.
  - 폴더 선택(기존 컴포넌트 재사용), "연결된 메모 섹션 넣기"(기본 on)
  - [다시 분석](force, 한도 차감 안내) / [노트 만들기]
- **완료**: `memoKeys.all()`·`['memos-meta-global']`·`['home-memos']` invalidate → `router.push('/memo/{id}')` + 토스트 "노트를 만들었어요".
- 모바일은 vaul Bottom Sheet(B-2 패턴), 데스크톱은 Modal. 다크모드·design-system 준수.
- 에러: 토스트 + 모달 내 지속 표시(토스트 원칙). 429는 한도 문구 그대로.

## 7. 검증

1. `bash scripts/verify-changes.sh` → `npx tsc --noEmit` → `npx next build`
2. `cropMargins` 단위 확인(임시 스크립트, 커밋 X): 여백 있는 데스크톱 웹 캡처 → 본문 칼럼만 남는지 / 전체 폭 사진·배너가 있는 페이지 → 배너에 끌려가지 않는지 / 모바일 캡처(여백 없음) → 크롭 안 함 / 크롭 전후 이미지를 저장해 **내가 직접 비교할 수 있게** 경로 보고.
3. PDF 분기 확인: 일반 텍스트 PDF → '텍스트형'(URL document) / 웹 캡처 PDF(jsPDF) → '이미지형' → 페이지 JPEG 추출 → 크롭 → 타일 / 스캔 PDF(JBIG2 등) → 폴백 로그.
4. `computeTiles` 단위 확인(임시 스크립트, 커밋 X): 1080×1000(1장) / 1080×19,600(≈20) / 1080×33,200(≈34) / 1440×44,300(≈62) / 2160×66,500(가로 1568 축소 후 ≈74) / 합계 150 경계 / 40 초과 시 청크 경계 겹침.
5. E2E (dev 서버, 실제 파일):
   - PDF: 텍스트 PDF(10~30쪽) / **웹페이지 캡처 PDF(jsPDF, 텍스트 0자 — 사용자가 보관 중인 `screencapture-blog-highoutputclub-…isojeong….pdf`, 20쪽, 23.4MB로 테스트)** / 스캔 PDF / 표 많은 PDF
   - 캡처 PDF는 **본문 작은 글씨·발표자료 캡션까지** 요약·인용에 정확히 반영됐는지(크롭 효과 확인), 원본 다운로드가 업로드 파일과 해시 동일한지
   - 이미지: **긴 캡처 1장(1080×15000 이상)** / **비율 1:18 + 1:31 긴 캡처 2장 묶음(분할 처리 경로)** / **카드뉴스 5~10장 묶음** / 글자 없는 사진 1장(`textAmount: low` 경고)
   - 각각: 요약 품질, 긴 캡처 **하단부 내용까지** 반영됐는지(타일 누락 검사), 겹침 구간 문장 중복 없는지, 기존 위키 재사용 비율, 새 위키 ≤3, 띄어쓴 위키 없음
   - 생성 노트를 **한 글자 수정 후 저장** → `wiki_links`/`tags` 불변 DB 확인 (가장 중요)
   - 그래프에서 기존 허브 연결 확인 / SourceFileBar 원본 보기·다운로드·전체 받기
   - 같은 세트 재업로드 → duplicate / 순서만 바꾼 세트 → 새 분석
   - 101쪽 PDF, 조각 151개 세트 → 업로드 전 차단
6. 분석별 `usage`로 비용 표(PDF/긴 캡처/카드뉴스) 보고.
7. 테스트 노트·파일 정리 여부는 나에게 확인 후 결정.

## 8. 마무리

- GAP 분석 99% 이상 (1~6 전 항목).
- CLAUDE.md: 폴더 구조, 스키마, RATE_LIMITS, 작업 이력. 백로그: "100쪽 초과 PDF 분할 요약", "위키 동의어(alias) 병합 제안", "메모 목록 '소스 노트' 필터", "PDF+이미지 혼합 세트".
- 커밋: `feat: 소스(PDF·이미지 묶음) 요약 노트 자동 생성 (맞춤 위키·태그 추천, 그래프 연결)` — diff 대조.
- push 금지. 보고: 변경 파일, E2E 결과 표, 소스 유형별 비용, 남은 이슈.
