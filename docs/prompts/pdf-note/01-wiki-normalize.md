# [1/3] 위키·태그 어휘 정규화 — 띄어쓰기/대소문자 차이로 허브가 쪼개지는 문제 차단

> PDF 노트 기능(2·3단계)의 선행 작업. 이 단계만으로도 독립적으로 가치가 있으므로 **커밋 1개로 분리**한다.

## 0. 사전 점검 (필수 — 하나라도 실패하면 멈추고 보고)

1. `git status` + `git log -1` 확인. **워킹트리가 clean이어야 한다.** (예외: 이 프롬프트 파일들이 있는 `docs/prompts/pdf-note/` 미추적 폴더 — 1단계 커밋에 함께 포함)
   - 미커밋 변경이 있으면(특히 `MemoEditor.tsx`, `globals.css`, `HeadingBoundaryGuard.ts`) 작업하지 말고 어떤 파일인지 보고 후 대기 (CLAUDE.md "멀티 세션 동시 작업 금지" 규칙).
2. 현재 브랜치가 `dev`인지 확인 → `git checkout -b feat/pdf-note` (이미 있으면 checkout만).
3. CLAUDE.md의 **코딩 컨벤션 / GAP 분석 원칙 / 배포 전 필수 체크리스트**를 읽고 따른다.

## 1. 배경 (코드 분석 결과)

- Weave 그래프에서 `[[키워드]]`는 메모→메모 링크가 아니라 **키워드 허브 노드**(`wiki:키워드`)다. 같은 키워드를 가진 메모들이 허브로 연결된다 (`src/hooks/useGraphData.ts`).
- 따라서 `[[행동경제학]]`과 `[[행동 경제학]]`은 **서로 다른 허브**가 되어 연결이 끊긴다. `#AI`와 `#ai`도 마찬가지.
- 현재 DB 실측: 위키 253개 전부 붙여쓰기, 정규화 기준 중복 0건. 즉 **지금은 깨끗하지만 AI가 띄어쓴 표기를 넣기 시작하면 깨지는 구조** → 예방 작업.
- `wiki_links`·`tags`는 저장 시 본문 텍스트에서 재추출된다 (`MemoEditor.tsx`의 `extractWikiLinks`/`extractTags`). **사용자가 쓴 본문 텍스트는 절대 자동으로 고치지 않는다.** 정규화는 "읽는 쪽(그래프·검색·자동완성·필터)"과 "AI가 새로 쓰는 쪽(3단계)"에서만 한다.

## 2. 구현

### 2-1. `src/lib/wiki/normalize.ts` (신규, 단일 출처)

```ts
/** 정규화 키: NFC → 소문자 → 공백·_·-·가운뎃점(·‧・) 제거 */
export function wikiKey(label: string): string

/** 태그용 키: NFC → 소문자 (태그는 정규식상 공백이 없음) */
export function tagKey(label: string): string

/**
 * 라벨 목록(+사용 횟수) → key별 대표 표기 Map.
 * 대표 선정: ① 사용 횟수 많은 것 ② 동률이면 공백 없는 표기 ③ 그래도 동률이면 localeCompare('ko') 앞선 것
 * (결정적이어야 함 — 같은 입력이면 항상 같은 대표)
 */
export function buildCanonicalMap(entries: Array<{ label: string; count: number }>, keyFn = wikiKey): Map<string, string>

/** 라벨을 기존 대표 표기로 치환 (없으면 원본 trim 반환) — 3단계 AI 후처리에서 사용 */
export function resolveToCanonical(label: string, canonical: Map<string, string>, keyFn = wikiKey): string
```

- 포함 관계(`마케팅` ↔ `마케팅전략`, `성장` ↔ `성장형사고방식`)는 **상하위 개념이지 중복이 아니다. 절대 합치지 않는다.** (키가 완전히 같을 때만 병합)

### 2-2. 그래프 허브 병합 — `src/hooks/useGraphData.ts`

- `buildGraph()` 1단계에서 전체 메모의 wiki/tag 사용 횟수를 집계 → `buildCanonicalMap`으로 대표 표기 결정.
- `wikiMap`/`tagMap`을 **정규화 키 기준**으로 구성. 노드 id는 기존 호환을 위해 `wiki:${대표표기}` / `tag:${대표표기}` 형식 유지 (GraphView의 허브 클릭 → 메모 목록 필터 이동 등 기존 핸들러가 라벨 기반이므로 깨지지 않게).
- 한 메모가 같은 키의 변형을 둘 다 가진 경우 **링크 중복 생성 금지** (메모별 Set으로 dedupe) — linkCount가 부풀지 않게.
- GraphView에서 허브 클릭 시 넘기는 값/쿼리 파라미터를 확인하고, 수신 측(메모 목록 필터)이 키 비교를 하도록 2-4와 맞춘다.

### 2-3. 자동완성 — `useAllMemosMeta.ts`, `WikiSuggest.tsx`

- `useAllMemosMeta`: `allWikiLinks`/`allTags`를 대표 표기로 **dedupe**하고 사용 횟수 내림차순 정렬 (자주 쓰는 허브가 먼저 보이게). 반환 타입에 `wikiCanonical: Map<string,string>`도 추가 (3단계 재사용).
- `WikiSuggest`: 필터를 `wikiKey(kw).includes(wikiKey(query))`로 교체 → "행동 경" 입력 시 `행동경제학` 제안.
  - `showNew`(새로 만들기 항목)는 **query의 키와 같은 키가 이미 있으면 숨긴다** → 이미 있는 허브의 띄어쓴 변형을 새로 만드는 경로 차단.
- 태그 자동완성 컴포넌트(`TagSuggest.tsx`)도 같은 방식(`tagKey`)으로.

### 2-4. 필터·검색 — 키 비교로 통일

- `MemoList.tsx`: `allWikis`/`allTags` dedupe(대표 표기), `activeWiki`/`activeTag` 필터를 키 비교로 (`m.wikiLinks?.some(w => wikiKey(w) === wikiKey(activeWiki))`). 검색창 `[[`/`#` 자동완성도 동일.
- `QuickCaptureModal.tsx`, `PlanFormModal.tsx`의 위키 검색(`w.toLowerCase().includes(...)`)을 키 기반으로.
- `rg "wikiLinks|wiki_links|allWikiLinks|allTags"`로 누락된 비교 지점이 없는지 전수 확인하고 목록을 보고.

### 2-5. 건드리지 않는 것

- `MemoEditor.tsx`의 추출·저장 로직, DB에 저장된 원본 표기 — **변경 금지**.
- 데이터 마이그레이션 없음 (현재 중복 0건, 읽기 측 병합으로 충분).

## 3. 검증

1. 정규화 함수 단위 확인 (임시 `npx tsx` 스크립트, 커밋하지 않음):
   - `wikiKey('행동 경제학') === wikiKey('행동경제학')` ✅
   - `wikiKey('AI 윤리') === wikiKey('ai윤리')` ✅
   - `wikiKey('마케팅') !== wikiKey('마케팅전략')` ✅
   - `buildCanonicalMap` 대표 선정이 결정적인지 (입력 순서 섞어도 결과 동일)
2. Supabase에서 병합 후보 리포트 SQL 실행 → 현재 0건인지 확인 (결과를 보고):
   ```sql
   with w as (select unnest(wiki_links) kw from memos where is_deleted=false)
   select lower(regexp_replace(kw,'[\s_\-·‧・]','','g')) k, array_agg(distinct kw), count(*)
   from w group by 1 having count(distinct kw) > 1;
   ```
3. 수동 시나리오 (dev 서버): 테스트 메모 2개에 `[[테스트 허브]]`, `[[테스트허브]]` 입력 → 그래프에 허브 **1개**, 두 메모 모두 연결 → 확인 후 테스트 메모 삭제.
4. `bash scripts/verify-changes.sh` → `npx tsc --noEmit` → `npx next build` 모두 통과.

## 4. 마무리

- GAP 분석(CLAUDE.md 형식)으로 2-1~2-5 충족률 99% 이상 확인.
- CLAUDE.md: 폴더 구조에 `lib/wiki/normalize.ts` 추가, `## 작업 이력`에 날짜와 함께 기록.
- 커밋(`docs/prompts/pdf-note/` 포함): `feat: 위키·태그 정규화 키 도입 (그래프 허브 병합·자동완성·필터)` — 커밋 직전 메시지·이력이 실제 diff와 일치하는지 대조.
- push는 하지 않는다. 완료 후 변경 파일 목록과 GAP 결과를 보고.
