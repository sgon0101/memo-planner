# CLAUDE.md — 메모 플래너 프로젝트 컨텍스트

> 이 파일은 Claude Code가 매 세션 시작 시 자동으로 읽는 파일입니다.
> 프로젝트 전반의 컨텍스트, 규칙, 스펙을 담고 있습니다.

---

## 프로젝트 개요

**앱 이름**: 나만의 메모 플래너 (가칭)
**목적**: 메모장 + 플래너 통합 시스템. AI가 메모·플랜 데이터를 분석해 인사이트를 제공하고 인생 설계를 도와주는 개인용 도구.
**현재 단계**: 초기 개발 단계

---

## 기술 스택

| 영역 | 기술 | 버전 |
|---|---|---|
| 프레임워크 | Next.js (App Router) | 14+ |
| 언어 | TypeScript | 5+ |
| 스타일 | Tailwind CSS | 3+ |
| 에디터 | Tiptap | 2+ |
| DB / 백엔드 | Supabase (PostgreSQL + Auth + Storage) | - |
| AI | Claude API | claude-sonnet-4-5 |
| 캘린더 | Google Calendar API | v3 |
| 상태관리 | Zustand | - |
| 날짜 처리 | date-fns | - |
| 배포 | Vercel | - |

---

## 프로젝트 폴더 구조

```
memo-planner/
├── app/
│   ├── (auth)/
│   │   ├── login/
│   │   └── signup/
│   ├── (main)/
│   │   ├── layout.tsx          # 사이드바 + 헤더 공통 레이아웃
│   │   ├── memo/
│   │   │   ├── page.tsx        # 메모 목록
│   │   │   └── [id]/
│   │   │       └── page.tsx    # 메모 에디터
│   │   ├── planner/
│   │   │   └── page.tsx        # 플래너 (캘린더)
│   │   ├── insights/
│   │   │   └── page.tsx        # AI 인사이트
│   │   └── settings/
│   │       └── page.tsx        # 설정
│   ├── api/
│   │   ├── ai/
│   │   │   ├── chat/route.ts       # AI 대화
│   │   │   ├── insights/route.ts   # 갭 분석 / 관심사 분석
│   │   │   └── report/route.ts     # 회고 리포트 생성
│   │   ├── calendar/
│   │   │   └── sync/route.ts       # Google Calendar 동기화
│   │   └── export/
│   │       └── route.ts            # PDF / MD / JSON 내보내기
│   ├── globals.css
│   └── layout.tsx
├── components/
│   ├── layout/
│   │   ├── Sidebar.tsx
│   │   ├── Header.tsx
│   │   └── MobileNav.tsx
│   ├── memo/
│   │   ├── FolderPanel.tsx         # 폴더 목록 + 색상 관리
│   │   ├── ColorWheelModal.tsx     # 컬러 휠 UI
│   │   ├── MemoList.tsx            # 카드/리스트/타임라인 뷰
│   │   ├── MemoCard.tsx            # 메모 카드 (제목 + 미리보기)
│   │   ├── MemoEditor.tsx          # Tiptap 에디터 래퍼
│   │   ├── EditorToolbar.tsx       # 서식 툴바
│   │   ├── LockModal.tsx           # 잠금 비밀번호 모달
│   │   └── VersionHistory.tsx      # 버전 이력
│   ├── planner/
│   │   ├── CalendarView.tsx        # 월/주/일 캘린더
│   │   ├── PlanPanel.tsx           # 날짜별 플랜 패널
│   │   ├── PlanForm.tsx            # 플랜 작성 폼
│   │   ├── RangeBar.tsx            # 범위 플랜 바
│   │   └── TimePicker.tsx          # 시간 설정
│   ├── insights/
│   │   ├── GapAnalysis.tsx         # 생각-행동 갭 분석
│   │   ├── BubbleChart.tsx         # 관심사 버블 차트
│   │   ├── MindMap.tsx             # 관심사 마인드맵
│   │   ├── RetroReport.tsx         # 회고 리포트
│   │   └── AIChat.tsx              # AI 대화
│   └── ui/
│       ├── Button.tsx
│       ├── Modal.tsx
│       ├── Tooltip.tsx
│       └── Badge.tsx
├── lib/
│   ├── supabase/
│   │   ├── client.ts               # 브라우저 클라이언트
│   │   ├── server.ts               # 서버 클라이언트
│   │   └── schema.sql              # 테이블 스키마 전체
│   ├── ai/
│   │   ├── claude.ts               # Claude API 래퍼
│   │   ├── prompts.ts              # 프롬프트 모음
│   │   └── analyzer.ts             # 메모·플랜 분석 로직
│   ├── crypto/
│   │   └── lock.ts                 # AES-256 암호화/복호화
│   ├── export/
│   │   ├── pdf.ts                  # PDF 내보내기
│   │   └── markdown.ts             # Markdown 내보내기
│   └── utils.ts
├── store/
│   ├── memoStore.ts                # 메모 상태 (Zustand)
│   ├── plannerStore.ts             # 플래너 상태
│   ├── folderStore.ts              # 폴더 상태
│   └── uiStore.ts                  # UI 상태 (다크모드 등)
├── types/
│   └── index.ts                    # 전체 타입 정의
├── hooks/
│   ├── useMemos.ts
│   ├── usePlanner.ts
│   ├── useAI.ts
│   └── useOfflineSync.ts
├── public/
│   ├── manifest.json               # PWA 설정
│   └── icons/
├── CLAUDE.md                       # ← 이 파일
├── .env.local                      # 환경 변수 (git 제외)
├── .env.example                    # 환경 변수 예시
└── README.md
```

---

## Supabase 테이블 스키마

```sql
-- 폴더
create table folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  name text not null,
  color_h integer default 260,   -- HSL 색상 (Hue)
  color_s integer default 60,    -- HSL 채도 (Saturation)
  color_l integer default 80,    -- HSL 명도 (Lightness)
  parent_id uuid references folders(id), -- 서브폴더
  order_index integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 메모
create table memos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  folder_id uuid references folders(id),
  title text default '',
  content jsonb,                  -- Tiptap JSON
  content_text text,              -- 전문 검색용 plain text
  is_pinned boolean default false,
  is_starred boolean default false,
  is_locked boolean default false,
  locked_content text,            -- AES-256 암호화 내용
  is_deleted boolean default false,
  deleted_at timestamptz,
  tags text[] default '{}',
  linked_plan_ids uuid[] default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 메모 버전 이력
create table memo_versions (
  id uuid primary key default gen_random_uuid(),
  memo_id uuid references memos(id) on delete cascade,
  content jsonb,
  content_text text,
  title text,
  created_at timestamptz default now()
);

-- 플랜
create table plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  title text not null,
  description text,
  color text default '#7F77DD',
  date date,
  start_date date,               -- 범위 플랜 시작일
  end_date date,                 -- 범위 플랜 종료일
  start_time time,               -- null = 온종일
  end_time time,
  is_all_day boolean default true,
  is_completed boolean default false,
  repeat_type text,              -- null / daily / weekly / monthly
  dday_target date,
  google_event_id text,          -- Google Calendar 동기화 ID
  linked_memo_ids uuid[] default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 즐겨찾기 플랜 제목
create table plan_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  title text not null,
  color text not null,
  created_at timestamptz default now()
);

-- AI 대화 기록
create table ai_chats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  role text not null,            -- 'user' | 'assistant'
  content text not null,
  created_at timestamptz default now()
);

-- 회고 리포트 캐시
create table retro_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  period text not null,          -- 'week' | 'month' | 'quarter' | 'year'
  period_start date not null,
  report_json jsonb,
  created_at timestamptz default now()
);

-- Google Calendar 등 외부 서비스 OAuth 토큰
create table user_integrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  provider text not null,        -- 'google_calendar'
  access_token text,
  refresh_token text,
  token_expiry timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, provider)
);
```

---

## 환경 변수 목록

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# AI
ANTHROPIC_API_KEY=

# Google
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# Auth
NEXTAUTH_SECRET=
NEXTAUTH_URL=http://localhost:3000

# 암호화
ENCRYPTION_SECRET=           # AES-256 키 (32자 이상 랜덤 문자열)
```

---

## 핵심 타입 정의 (types/index.ts)

```typescript
export interface Folder {
  id: string;
  userId: string;
  name: string;
  colorH: number;
  colorS: number;
  colorL: number;
  parentId: string | null;
  orderIndex: number;
  createdAt: string;
  updatedAt: string;
}

export interface Memo {
  id: string;
  userId: string;
  folderId: string | null;
  title: string;
  content: Record<string, any>; // Tiptap JSON
  contentText: string;
  isPinned: boolean;
  isStarred: boolean;
  isLocked: boolean;
  isDeleted: boolean;
  deletedAt: string | null;
  tags: string[];
  linkedPlanIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Plan {
  id: string;
  userId: string;
  title: string;
  description: string;
  color: string;
  date: string | null;
  startDate: string | null;
  endDate: string | null;
  startTime: string | null;
  endTime: string | null;
  isAllDay: boolean;
  isCompleted: boolean;
  repeatType: 'daily' | 'weekly' | 'monthly' | null;
  ddayTarget: string | null;
  googleEventId: string | null;
  linkedMemoIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PlanTemplate {
  id: string;
  userId: string;
  title: string;
  color: string;
}
```

---

## 코딩 컨벤션

- **컴포넌트**: PascalCase, 파일당 1개
- **훅**: camelCase, `use` 접두사
- **타입**: interface 우선, 필요 시 type
- **API Route**: `/app/api/` 하위, `route.ts`
- **에러 처리**: try-catch 필수, 사용자에게 toast 알림
- **주석**: 복잡한 로직에만, 한국어 가능
- **import 순서**: React → 외부 라이브러리 → 내부 모듈 → 타입
- **Tailwind**: 인라인 클래스 사용, 복잡한 스타일은 `cn()` 유틸 활용
- **상태**: 서버 상태는 Supabase 실시간 구독, 클라이언트 UI 상태는 Zustand

---

## AI 프롬프트 원칙 (lib/ai/prompts.ts)

- 모든 AI 분석은 사용자의 **실제 메모·플랜 데이터**를 컨텍스트로 주입
- 응답은 **한국어**로
- 개인정보 보호: AI API 호출 시 사용자 ID만 참조, 개인 식별 정보 최소화
- 갭 분석 프롬프트: 메모 키워드 ↔ 플랜 제목 교차 비교
- 회고 리포트: 기간 내 메모 수 / 플랜 완료율 / 자주 쓴 태그 기반 생성

---

## 개발 진행 상태

- [x] 1. 프로젝트 초기 세팅 (Next.js + memo-planner 생성 완료)
- [x] 2. Supabase 스키마 생성 (테이블 7개 + RLS 정책 적용 완료)
- [x] 3. 인증 (Supabase Auth)
- [x] 4. 레이아웃 (헤더 + 사이드바)
- [x] 5. 메모장 — 폴더 CRUD + Color Wheel
- [x] 6. 메모장 — Tiptap 에디터
- [x] 7. 메모장 — 메모 CRUD + 잠금/중요/고정
- [x] 8. 메모장 — 버전 이력 + 휴지통
- [x] 9. 플래너 — 캘린더 UI + 범위 플랜
- [x] 10. 플래너 — 플랜 CRUD + 시간 + 반복
- [x] 11. 플래너 — Google Calendar 연동
- [x] 12. AI 인사이트 — Claude API + 4개 탭
- [x] 13. 설정 페이지
- [x] 14. 내보내기 / 가져오기 / 백업
- [x] 15. PWA + 다크모드 + 반응형
- [x] 16. 배포 (Vercel)

---

## 작업 시 주의사항

1. 각 단계 완료 시 `개발 진행 상태` 체크박스를 업데이트해줘
2. 새로운 컴포넌트나 훅을 만들면 위 폴더 구조에 반영해줘
3. Supabase 스키마가 변경되면 `schema.sql` 섹션을 업데이트해줘
4. 환경 변수가 추가되면 `.env.example`과 이 파일의 환경 변수 목록에 추가해줘
5. 막히는 부분은 바로 물어봐. 혼자 해결하려다 방향 틀어지지 않도록

---

## GAP 분석 및 작업 원칙 (필수 준수)

### 기본 원칙
모든 설계 및 구현 과정에서 **항상 GAP 분석을 먼저 수행**한다.
GAP 분석 없이 다음 단계로 넘어가거나 새로운 기능을 추가하지 않는다.

### GAP 분석 방법

매 작업 단계마다 아래 형식으로 스스로 점검한다:

```
## GAP 분석 — [현재 단계명]

### 설계 기준 (CLAUDE.md 스펙)
- [ ] 항목 1
- [ ] 항목 2
- [ ] 항목 3

### 구현 현황
- [x] 항목 1 — 완료
- [x] 항목 2 — 완료
- [ ] 항목 3 — 미구현 (이유: ...)

### 누락/불일치 항목
- 항목 3: 아직 구현되지 않음 → 이번 작업에서 처리 예정

### GAP 충족률
완료: 2 / 전체: 3 = 66.7% ← 아직 다음 단계 진행 불가

### 판정
❌ 미충족 — 누락 항목 처리 후 재검증 필요
```

### 다음 단계 진행 기준

| 조건 | 판정 | 행동 |
|---|---|---|
| GAP 충족률 < 99% | ❌ 미충족 | 누락 항목 처리 후 재검증 |
| GAP 충족률 ≥ 99% | ✅ 충족 | 다음 단계 진행 가능 |

> **GAP 충족률이 99% 이상일 때만** 아래 행동을 허용한다:
> - 새로운 기능 추가 또는 검증
> - 다음 개발 단계로 이동
> - 배포 (Vercel)

### 메모리 저장 및 지속 작업 원칙

1. **각 단계 완료 후 반드시 메모리 저장**
   - CLAUDE.md의 `개발 진행 상태` 체크박스 업데이트
   - 변경된 스키마, 폴더 구조, 환경 변수를 CLAUDE.md에 즉시 반영
   - 작업 로그를 `## 작업 이력` 섹션에 날짜와 함께 기록

2. **메모리 저장 후 수정·디버깅 지속**
   - 저장 완료 후 바로 다음 미완료 항목으로 이어서 작업
   - 세션이 끊겨도 CLAUDE.md를 읽으면 이전 상태 그대로 재개 가능
   - 버그 발견 시 즉시 수정 후 해당 단계 GAP 분석 재수행

3. **디버깅 우선순위**
   - 빌드 에러 → 런타임 에러 → 기능 오작동 → UI 이슈 순으로 처리
   - 에러 수정 후 영향 범위 확인 (관련 컴포넌트·훅·API 모두 점검)

---

## 작업 이력

| 날짜 | 단계 | 내용 | GAP 충족률 |
|---|---|---|---|
| 2026-04-17 | 초기 설정 | CLAUDE.md 생성, 프로젝트 구조 정의 | - |
| 2026-04-17 | 1단계 완료 | Next.js memo-planner 프로젝트 생성, 패키지 설치 | 100% |
| 2026-04-17 | 2단계 완료 | Supabase 프로젝트 생성, 테이블 7개 + RLS 정책 적용 | 100% |
| 2026-04-17 | 3~8단계 완료 | Auth, 레이아웃, 메모 CRUD, 에디터, 잠금, 버전이력, 휴지통 | 100% |
| 2026-04-17 | 9단계 완료 | 플래너 캘린더 UI (월/주/일 뷰), 범위 플랜 바, PlanPanel, PlanFormModal | 100% |
| 2026-04-17 | 10단계 완료 | 플랜 CRUD 고도화 — 반복 설정(daily/weekly/monthly), TimePicker 컴포넌트, PlanPanel 수정 버튼, editPlan 흐름 연결 | 100% |
| 2026-04-18 | 11단계 완료 | Google Calendar 연동 — OAuth 흐름(auth/callback/disconnect), sync API, lib/google/calendar.ts, user_integrations 테이블, CalendarView 동기화 버튼 | 100% |
| 2026-04-18 | 12단계 완료 | AI 인사이트 — AIChat(스트리밍), GapAnalysis, BubbleChart, MindMap, RetroReport(캐시), 5탭 레이아웃, lib/ai/* 3파일, API 3개 | 100% |
| 2026-04-18 | 13단계 완료 | 설정 페이지 — 프로필, 다크모드 토글, Google Calendar 연결/해제, 로그아웃, 계정삭제, toast 알림 | 100% |
| 2026-04-18 | 14단계 완료 | 내보내기/가져오기/백업 — Markdown 내보내기, JSON 전체 백업, PDF 인쇄, JSON 가져오기(복원), /api/export GET/POST | 100% |
| 2026-04-18 | 15단계 완료 | PWA + 다크모드 + 반응형 — manifest.json, SVG 아이콘, sw.js(Service Worker), ServiceWorkerRegister, PWA 메타태그, 모바일 PlanPanel 바텀시트, turbopack 설정 | 100% |
| 2026-04-18 | 16단계 완료 | Vercel 배포 — dev→main PR merge, 환경변수 설정 안내 | 100% |
| 2026-04-18 | 추가 기능 | Google 소셜 로그인/회원가입, 로그인 상태 유지 체크박스, Google Cloud Console OAuth 리디렉션 URI 4개 + Calendar 스코프 설정 완료 | 100% |
| 2026-04-18 | 최종 완료 | 전체 16단계 + 추가 기능 완성. 프로덕션 URL: https://memo-planner.vercel.app | 100% |
| 2026-04-17 | 3단계 완료 | Supabase Auth 인증 — 로그인/회원가입 페이지, proxy.ts 미들웨어, auth/callback 라우트, lib/supabase client/server | 100% |
| 2026-04-17 | 4단계 완료 | 레이아웃 — Sidebar/Header/MobileNav/DarkModeProvider/SidebarSpacer 컴포넌트, (main) 레이아웃, placeholder 페이지 4개, uiStore | 100% |
| 2026-04-17 | 5단계 완료 | 폴더 CRUD + Color Wheel — FolderPanel, ColorWheelModal, useFolders 훅, folderStore, types/index.ts | 100% |
| 2026-04-17 | 6단계 완료 | Tiptap 에디터 — MemoEditor(자동저장 1.5s debounce), EditorToolbar(전체 서식), memo/[id] 페이지, memoStore, typography 플러그인 | 100% |
| 2026-04-17 | 7단계 완료 | 메모 CRUD — MemoList(카드/리스트뷰, 검색, 정렬), MemoCard(고정/중요/잠금/삭제), LockModal(AES-256), lib/crypto/lock.ts, useMemos 훅 | 100% |
| 2026-04-17 | 8단계 완료 | 버전 이력 + 휴지통 — VersionHistory 패널, useVersions 훅(5분 쿨다운, 최대 20개), MemoEditor 이력 버튼, FolderPanel 휴지통, 복원/영구삭제/비우기 | 100% |
| 2026-04-18 | 버그 수정 1 | 새 메모 저장 시 목록 미노출 — user_id 추가, handleBackToList await save, skipNavigate 옵션 | 100% |
| 2026-04-18 | 버그 수정 2 | 플래너 플랜 저장 오류 — createPlan에 user_id 추가, 실제 에러 메시지 노출 | 100% |
| 2026-04-18 | 기능 개선 3 | 오늘 버튼 — 뷰별 isViewingToday, 비활성(회색)/미오늘(violet) 스타일, plannerStore currentWeek 추가 | 100% |
| 2026-04-18 | 기능 구현 4 | 주 뷰(WeekView) + 일 뷰(DayView) — 시간 그리드, 플랜 블록, 현재 시각 표시, 뷰별 헤더 네비게이션 | 100% |

---

## Git 전략

### 레포지토리
- **GitHub 주소**: https://github.com/sgon0101/memo-planner
- **기본 브랜치**: `main` (배포 브랜치) / `dev` (개발 브랜치)

### 브랜치 규칙

| 브랜치 | 용도 | push 규칙 |
|---|---|---|
| `main` | Vercel 자동 배포 연결 | PR merge만 허용, 직접 push 금지 |
| `dev` | 기본 개발 작업 브랜치 | 자유롭게 push 가능 |
| `feat/기능명` | 신규 기능 개발 | dev로 PR 후 merge |
| `fix/버그명` | 버그 수정 | dev로 PR 후 merge |

### 커밋 메시지 형식

```
타입: 작업 내용 (한국어 가능)

예시:
feat: 메모 에디터 Tiptap 기본 세팅
fix: 폴더 색상 저장 안 되는 버그 수정
chore: Supabase 환경 변수 설정
docs: CLAUDE.md GAP 분석 섹션 추가
style: 메모 카드 레이아웃 미세 조정
refactor: 메모 CRUD 훅 zustand로 이관
```

| 타입 | 사용 상황 |
|---|---|
| `feat` | 새로운 기능 추가 |
| `fix` | 버그 수정 |
| `chore` | 설정, 패키지, 환경 변수 등 |
| `docs` | 문서 작업 (CLAUDE.md 포함) |
| `style` | UI/스타일 수정 (기능 변경 없음) |
| `refactor` | 리팩터링 (기능 동일, 코드 개선) |

### 초기 GitHub 연결 순서

```bash
# 1. 로컬 git 초기화
cd memo-planner
git init
git add .
git commit -m "chore: 프로젝트 초기 설정 및 CLAUDE.md 생성"

# 2. GitHub 레포와 연결 (레포 먼저 생성 필요)
git remote add origin https://github.com/[내 아이디]/memo-planner.git
git branch -M main
git push -u origin main

# 3. dev 브랜치 생성 후 이동 (이후 모든 작업은 dev에서)
git checkout -b dev
git push -u origin dev
```

### Vercel 자동 배포 연결

```
vercel.com → New Project
→ Import from GitHub → memo-planner 선택
→ 환경 변수 입력 (.env.local 내용 그대로)
→ Deploy
```

- `main` 브랜치에 merge될 때마다 Vercel이 자동으로 빌드·배포
- `dev` 브랜치는 Vercel Preview URL로 미리보기 가능

### Claude Code 작업 시 Git 원칙

1. 각 개발 단계 시작 시 `feat/단계명` 브랜치 생성
2. 단계 완료 + GAP 충족률 99% 이상 확인 후 `dev`로 merge
3. 기능 묶음이 완성되면 `dev` → `main` PR 생성 후 배포
4. 커밋은 작업 단위로 자주 — 한 커밋에 너무 많은 변경 금지

---

## 참고 레퍼런스

| 참고 대상 | 참고할 부분 |
|---|---|
| Notion | 블록 에디터, 폴더 구조 |
| Craft | 카드형 메모, 깔끔한 UI |
| Sunsama | 플래너 UX, 일일 브리핑 |
| Obsidian | 마인드맵, 태그 시스템 |
| Reflect | AI 메모 연결 추천 |
