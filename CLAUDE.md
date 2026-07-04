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
│   │   ├── MobileNav.tsx
│   │   ├── KeyboardShortcuts.tsx       # 글로벌 단축키 + 안내 모달
│   │   └── NotificationScheduler.tsx   # 브라우저 알림 백그라운드 스케줄러
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
│   ├── notifications/
│   │   └── scheduler.ts            # 브라우저 Notification + setTimeout 스케줄러
│   ├── graph/
│   │   └── colors.ts               # 그래프 노드 색상 단일 출처
│   ├── planner/
│   │   ├── expandRecurringPlans.ts # rrule 기반 인스턴스 전개 (+legacy fallback)
│   │   ├── rrulePresets.ts         # RRULE preset/parser/한국어 라벨러
│   │   └── dragHelpers.ts          # 드래그/리사이즈 공용 상수·헬퍼 (HOUR_H, snap, ...)
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
│   ├── useSwipeGesture.ts          # swipe 제스처 통합 훅 (pointer+touch)
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

# Cloudflare R2
CLOUDFLARE_R2_ACCOUNT_ID=
CLOUDFLARE_R2_ACCESS_KEY_ID=
CLOUDFLARE_R2_SECRET_ACCESS_KEY=
CLOUDFLARE_R2_BUCKET_NAME=
CLOUDFLARE_R2_PUBLIC_URL=

# Google Drive 백업
GOOGLE_DRIVE_BACKUP_FOLDER_ID=
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
  repeatType: 'daily' | 'weekly' | 'monthly' | null;  // legacy
  repeatEndDate: string | null;
  rruleStr: string | null;                              // RFC 5545 RRULE (신규, 우선)
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
| 2026-04-18 | 9개 기능 개선 #1 | 폴더 추가 버그 수정 — createFolder에 user_id 추가 | 100% |
| 2026-04-18 | 9개 기능 개선 #2 | 메모 카드 이미지 썸네일 — Tiptap JSON 트리 순회로 첫 이미지 추출, aspect-video 표시 | 100% |
| 2026-04-18 | 9개 기능 개선 #3~4 | 에디터 별표 버튼 + 목록 이동 다이얼로그 — isStarred 토글, 미저장 확인 dialog, pendingMemoId | 100% |
| 2026-04-18 | 9개 기능 개선 #5 | 메모 목록 — 타임라인 뷰, 정렬 칩(5종), 태그 필터 칩 | 100% |
| 2026-04-18 | 9개 기능 개선 #6 | 에디터 우측 메모 목록 패널 — MemoSidePanel(220px), 검색, 선택 네비게이션 | 100% |
| 2026-04-18 | 9개 기능 개선 #7 | 오늘 버튼 활성화 조건 수정 — selectedDate 기준으로 단순화 | 100% |
| 2026-04-18 | 9개 기능 개선 #8 | 플랜 상세 작성 — 설명 textarea, 즐겨찾기 템플릿 CRUD, 메모 연결 팝업, 고급 설정 토글 | 100% |
| 2026-04-18 | 9개 기능 개선 #9 | 메인 홈 화면 — HomeClient, 인사말, 통계 3종, 빠른 메모 입력, 최근 메모 5개, 이번 주 플랜, Sidebar/MobileNav 홈 링크 추가 | 100% |
| 2026-04-18 | 11개 기능 2차 #1 | 폴더 추가 모달(이름+색상) — ColorWheelModal showNameInput/만들기 버튼, FolderPanel "+" 클릭 시 모달 오픈 | 100% |
| 2026-04-18 | 11개 기능 2차 #2 | 폴더 이름 편집 버그 수정 — FolderItem 외부 컴포넌트 분리로 리마운트 방지, ESC 취소 지원 | 100% |
| 2026-04-18 | 11개 기능 2차 #4 | 에디터 고정(📌) 버튼 추가 — isPinned 상태, handleTogglePin, 즉시 Supabase 저장 | 100% |
| 2026-04-18 | 11개 기능 2차 #6 | 메모 목록 월별 필터 칩 — 월 클릭 시 해당 월 메모만 표시, 복수 월 있을 때만 노출 | 100% |
| 2026-04-18 | 11개 기능 2차 #7 | 폴더 정보 표시 + 폴더 이동 — 카드 하단 폴더명/색상, 에디터 폴더 선택 드롭다운, 카드 메뉴 폴더 이동 | 100% |
| 2026-04-18 | 11개 기능 2차 #10 | 플랜 상세 패널 — PlanDetailPanel 슬라이드 오버레이, 날짜/시간/설명/연결메모/반복 표시, 수정/삭제 버튼 | 100% |
| 2026-04-18 | 그래프 뷰 완성 | GraphView D3 Canvas + 슬리핑 시뮬, GraphSettings/Tooltip, useGraphData, /api/graph/analyze, /graph 라우팅, Sidebar/MobileNav 메뉴, from=graph 버튼, [[ 위키 자동완성, wiki_links 저장 | 100% |
| 2026-04-18 | 3개 기능 추가 #1 | 메모 사이드 패널 기본값 열림 — localStorage 저장/복원, 기본값 true | 100% |
| 2026-04-18 | 3개 기능 추가 #2 | 메모 카드 드래그 앤 드랍 폴더 그룹핑 — HTML5 DnD + 터치 지원, dragStore, FolderPanel 드랍존, ★중요 드랍, 토스트 알림 | 100% |
| 2026-04-18 | 3개 기능 추가 #3 | 타임라인 뷰 기간 필터링 — CalendarPicker(범위 하이라이트), TimelineFilter(2탭), 월별 칩, 날짜별 2단계 그룹핑 | 100% |
| 2026-04-18 | 그래프 줌 연동 라벨 | 줌 레벨 연동 노드 라벨 페이드 인/아웃 — getLabelOpacity(lerp), drawRef 패턴, 허브 최소 0.4, 텍스트 외곽선(strokeText), 12자 truncation | 100% |
| 2026-04-19 | R2 이미지 압축 | Cloudflare R2 연동 + 이미지 자동 압축 — aws-sdk/sharp, WebP(85%)/1920px, /api/upload, 드래그앤드랍/붙여넣기, 압축률 토스트, 설정 스토리지 현황, 마이그레이션 스크립트 | 100% |
| 2026-04-19 | Google Drive 백업 | Tiptap→Markdown 변환(전체 노드 타입), drive.file OAuth, /api/drive/auth+callback, /api/backup/google-drive(individual/combined), 설정 Drive 섹션 | 100% |
| 2026-04-19 | 성능 최적화 | React Query 캐싱(staleTime 30s), LIST_COLS 경량 쿼리(content 제외), 무한 스크롤(20개씩 IntersectionObserver), dynamic import 코드 스플리팅(CalendarView/GraphView/AI탭 5종), Skeleton UI 6종, next.config.ts 이미지도메인+removeConsole, Memo 타입 wikiLinks 추가 | 100% |
| 2026-04-19 | 디자인 시스템 | ui-ux-pro-max 스킬 기반 — design-system/MASTER.md + 페이지별 오버라이드 6개, Sidebar active 인디케이터, MobileNav active dot, HomeClient StatCard/플랜 컬러스트립, Button/Toast/Input 공통 컴포넌트, EditorToolbar 통일, globals.css cursor-pointer 전역 | 100% |
| 2026-04-19 | 버그 수정 | 전체 메모 폴더 전환 버그 — useQuery data useEffect로 Zustand 동기화, 캐시 히트 시 stale data 방지 | 100% |
| 2026-04-19 | 수동 처리 #1 | 반복 플랜 인스턴스 전개 — expandRecurringPlans(), plannerStore(expandedPlans/recurringCompletions), usePlanner(toggleRecurringComplete/skipRecurringInstance/stopRecurringFromDate), CalendarView/PlanPanel/PlanDetailPanel 적용 | 100% |
| 2026-04-19 | 수동 처리 #2 | 휴지통 자동 삭제 — /api/cron/cleanup-trash(CRON_SECRET 인증), vercel.json 매일 자정 Cron, MemoCard 남은 일수 배지(7일 이하 빨강/초과 노랑) | 100% |
| 2026-04-19 | 버그 수정 | 설정 페이지 연결 상태 버그 — user_integrations 직접 조회(access_token 검증), Drive/Calendar 3상태 UI, 이메일 표시, Drive 해제 버튼, 콜백 ?connected= 파라미터 통일, searchParams 변경 시 재조회 | 100% |
| 2026-04-19 | 버그 수정 | OAuth 콜백 307 리다이렉트 버그 — proxy.ts(Next.js 16 미들웨어)에서 /api/drive, /api/calendar, /api/cron 인증 제외 + 콜백에서 서비스 롤 클라이언트로 교체(RLS 우회) | 100% |
| 2026-04-19 | 버그 수정 | Google Drive 백업 "Unexpected end of JSON" — route.ts 전체 try-catch, ROOT_FOLDER_ID 옵셔널, drive.ts parentId 타입 수정, 프론트 response.text() 우선 파싱 | 100% |
| 2026-04-19 | 기능 추가 | Drive 이미지 백업 + 메모 카드 썸네일 노출 — extractImageUrls/uploadImageToDrive, images/ 폴더 자동 생성, LIST_COLS에 content 추가, MemoCard onError 처리 | 100% |
| 2026-04-19 | 전체 자동 디버깅 | ESLint 에러 14→0개 수정, 폴더 삭제 FK 버그, Date.now 순수성, ref-during-render, 미사용 import 7개, 빌드 ✅ | 100% |
| 2026-04-19 | 그래프 태그/위키 개선 | 태그허브 클릭 좌측 패널(슬라이드인, 메모목록+날짜), 태그필터 하이라이트(dim), [[]] 위키노드명 제거, GraphSettings ✕ 버튼 | 100% |
| 2026-04-19 | 그래프 물리 시뮬 수정 | buildSim dep 분리(nodes/links/size만), force in-place 업데이트, toStrength/toCharge/toDistance 변환함수, 옵시디언 기본값, 슬라이더 1~10 통일, 방향 힌트 레이블 | 100% |
| 2026-04-19 | 마인드맵 탭 통합 | 마인드맵 탭 제거, 관심사 탭 → "관심사 분석"으로 통합, 버블+카드 2단계 UX, 버블/범례/카드 클릭 시 카테고리 강조+스크롤, 로딩 스켈레톤 | 100% |
| 2026-04-19 | 그래프 물리 슬라이더 개선 | "장력" → "중심 장력"(forceCenter.strength 제어), 링크 장력 0.3 고정, 충돌 반경 20px 고정, "라벨 최소 링크 수" 슬라이더 제거 | 100% |
| 2026-04-19 | 플래너 버그+기능 | 날짜 클릭 시 플랜 미표시 버그 수정(CalendarView→store expandedPlans 동기화), TimePicker 드롭다운 재작성(시 0~23, 분 0/10/20/30/40/50), 종일 토글 스위치, 소요 시간 표시, 유효성 검사 | 100% |
| 2026-04-19 | 미들웨어 정적파일 차단 수정 | proxy.ts matcher + SKIP_PATHS에 manifest.json/icons/images/robots.txt/sitemap.xml 추가 → PWA 307 리다이렉트 해결 | 100% |
| 2026-04-19 | 메모장+그래프 다기능 | 메모카드 태그칩(카드·리스트뷰), ResizableImageView(드래그·프리셋), TagSuggest(# 자동완성), 폴더 진입 시 신규 메모 폴더 자동지정, useGraphData folderStore 동기화(폴더필터) | 100% |
| 2026-04-24 | 태그 필터 드롭다운 | 필터바 태그 칩 → TagDropdown 통합(검색, ✓ 선택, ✕ 해제, Esc·외부클릭 닫힘, 다크모드 대응) | 100% |
| 2026-04-24 | 버그 수정 | 태그 드롭다운 overflow clip — TagDropdown을 overflow-x-auto 영역 밖으로 분리(CSS spec: overflow-x:auto → 양 축 clipping context 생성으로 absolute 패널 잘림) | 100% |
| 2026-04-24 | AI 2트랙 구현 | Track1 대화 히스토리(chat_rooms/chat_messages, 자동 요약) + Track2 user_profile(분석/편집/제안카드/이력) + AIChatLayout + UserProfile 탭 + 5개 API 신규 | 100% |
| 2026-04-24 | 버그 수정 | 폴더 삭제 시 메모 소프트 삭제(휴지통 이동) + 삭제 전 메모 수 경고 모달 + 메인 필터바 날짜 탭 제거(타임라인 뷰 전용) | 100% |
| 2026-05-24 | UX 패키지 1차 | (#3 죽은 코드 정리, #4 검색 #태그/[[위키/공백 AND, #2 D-day 활성화, #5 모바일 캘린더 스와이프, #1 글로벌 단축키, #6-A 브라우저 알림) — dev push + main merge + Vercel 배포 완료 | 100% |
| 2026-05-24 | UX 패키지 2차 | 모바일 PlanPanel swipe-down 닫기(그립 핸들 + 드래그 따라옴 + spring back) + 메모 검색 placeholder 반응형 + 도움 칩(#/[[ prefix 자동 입력) + 데스크탑 `/` 키 뱃지 | 100% |
| 2026-05-24 | #8 RRULE 확장 | `rrule@^2.8.1` 도입 · `plans.rrule_str` 컬럼 추가 · `expandRecurringPlans`를 rrule 기반(UTC 정오 dtstart, DST 안전) + legacy `repeat_type` fallback로 교체 · `lib/planner/rrulePresets.ts`(preset 9개/parser/한국어 라벨러) · PlanFormModal 빠른 프리셋 9종(없음/매일/평일/매주/격주/매월같은날/매월같은요일/매년/맞춤) + 맞춤 빌더(단위·간격·요일 다중) + 종료조건(끝없음/N회/날짜) · PlanDetailPanel·PlanPanel 한국어 RRULE 라벨 표시 · usePlanner/notifications 쿼리도 `rrule_str.not.is.null` OR 추가 | 100% |
| 2026-05-24 | #8 후속 픽스 | 반복 인스턴스 완료 해제 시 인스턴스 사라지던 버그(`is_completed=false`가 skip과 의미 충돌) — `toggleRecurringComplete`를 완료시 row delete 패턴으로 · `PlanDetailPanel` stale prop 픽스(zustand 직접 구독으로 fresh isCompleted) · `stopRecurringFromDate`가 `rrule_str` 내부 UNTIL도 갱신(`setUntilOnRRule` 헬퍼) · "이 일정 및 이후 모두 삭제" → "이 일정부터 반복 종료" 라벨 변경 · PlanFormModal autofill bar 차단(data-1p-ignore/form-type/name) | 100% |
| 2026-05-24 | #7 캘린더 드래그 | WeekView/DayView 블록을 Pointer Events로 드래그 — 시간 이동(15분 snap) + 요일 이동(WeekView) + 상하단 8px 핸들 리사이즈(`resize-top`/`resize-bottom`, 최소 15분) · 데스크탑 즉시, 모바일 long-press 450ms 후 진동 · document 레벨 pointer listener(setPointerCapture 모바일 실패 대응) · drag 중 body+scrollRef overflow lock + touchmove preventDefault · Android long-press contextmenu/selection 차단(`e.preventDefault`, `WebkitTouchCallout`, `onContextMenu`) · 시각 피드백: top+height 동적, translateX(요일), violet ring · `lib/planner/dragHelpers.ts` 신규 | 100% |
| 2026-05-24 | #9 Postgres FTS 검색 | `memos.search_vec` tsvector 컬럼 + GIN 인덱스 + 자동 갱신 트리거(title/content_text/tags/wiki_links를 weight A/B로) · `/api/memos/search` route(websearch_to_tsquery, 폴더 필터) · `useMemoSearch` hook(debounce 300ms + React Query 30s 캐시) · MemoList 검색을 client substring → 서버 FTS로 교체 · 검색 중 Search 아이콘 violet pulse · prefix(#태그/[[위키)는 서버에서 정리해 본문 매칭 | 100% |
| 2026-06-11 | 개선 1단계 | `useSwipeGesture` 통합 훅 — Sidebar/PlanPanel/CalendarView swipe를 pointer+touch 단일 파이프라인으로 통합(200ms dedupe, 축 잠금 후 capture), 파일 끝 null 바이트 정리 | 100% |
| 2026-06-11 | 개선 2단계 | 홈 캐시 — home-stats staleTime 0→5분, usePlanner mutation들이 home-stats/home-dday invalidate, AI chat user 메시지 insert 비동기화(스트림 시작 지연 제거) | 100% |
| 2026-06-11 | 개선 3단계 | 공통 `ui/Modal`(포커스 트랩+Escape+portal+body 스크롤 잠금) — Lock/ColorWheel/PlanForm/QuickCapture/KeyboardShortcuts 모달 마이그레이션, z-index 토큰 실사용 값으로 재정의(modal 100/toast 300), Toast 토큰 적용 | 100% |
| 2026-06-11 | 개선 4단계 | useMemos.softDelete 버그 수정 — 캐시 제거 후 folderId 조회로 폴더 카운트가 null 버킷에서 차감되던 문제(제거 전 확보로 변경) | 100% |
| 2026-06-11 | 개선 5단계 | `lib/graph/colors.ts` 색상 단일 출처 — GraphView/GraphCanvas/GraphSettings의 중복 nodeColor/hex 제거 | 100% |
| 2026-06-11 | 개선 6단계 | useGraphData O(n²) 제거 — simLink 검증 memos.some→Set, 허브 linkCount links.filter→사전 집계 Map | 100% |
| 2026-06-11 | lint 정리 | ESLint react-hooks 에러 26→0 — 실수정 4건(useId/dragX 파생/useLayoutEffect 2건) + 의도 패턴은 사유 명시 disable, Modal aria-hidden 버그·CalendarView import 누락·ResizableImageView 타입도 수정 | 100% |
| 2026-06-11 | 버그 수정 | 모바일 주/일 뷰 시간대 탭 시 키보드 깜빡임 반복 — Modal 포커스 트랩 effect가 inline onClose 의존으로 재실행되며 cleanup 포커스 복원이 input을 blur시키던 루프, 콜백 ref화 + mount 1회 고정으로 해결 | 100% |
| 2026-06-28 | 버그 수정 | 홈 진입 0.5s 빈 화면 회귀 — userId가 async로 늦게 들어와 mount 시점 useState/useQuery initialData가 null 캐시 키로 localStorage를 못 읽던 문제, `subscribeUserId`로 userId 도착 즉시 prevCount setState + queryClient.setQueryData(home-memos/home-stats/memos-all) 직접 복원 (#257 후속) | 100% |
| 2026-06-28 | PR-M1-A 오프라인 큐 | 오프라인 write queue (단순 액션) — `idb@8.0.3` 도입, `lib/sync/queueDB.ts`(IndexedDB write 큐) + `withQueue.ts`(오프라인 적재/온라인 flush 래퍼), `useOnlineStatus`/`useQueueStatus` 훅, `OfflineBanner`(상태 배너), `(main)/layout`·`SyncBootstrap` 연결, `useMemos`/`usePlanner` 단순 액션 큐 경유 처리 — dev push + PR #258 main merge (9be88b7) 배포 | 100% |
| 2026-06-28 | PR-M1-B 작성+본문 큐 | 오프라인 작성+본문 큐 — 임시 ID + ID 매핑 + 본문 overwrite. `queueDB` v2(op 4종 + id_map store) · `withQueue` v2(insert·body 헬퍼 + flush op별 분기) · `memoStore.swapId`/`plannerStore.swapPlanId` · `SyncBootstrap` flush 후 zustand+RQ 캐시 swap + URL silent 교체 + broadcast · `useMemos.createMemo`/`usePlanner.createPlan`/`MemoEditor.save`(insert+update) 큐 경유 · 이미지 첨부 오프라인 차단 토스트(R2 큐화는 M1-C) | 100% |
| 2026-06-28 | PR-M1-B 핫픽스 | `getUser()`→`getSession()` (오프라인 user_id 누락) — `getUser()`는 offline에서 토큰 refresh fetch fail로 throw → `user_id=''`로 큐 적재 → 복귀 시 RLS 400 → 5회 retry 후 give-up → UI 영구 고착. `getSession()`은 cookie sync 읽기라 offline-safe. `useMemos.createMemo`/`usePlanner.createPlan`/`MemoEditor.save`(insert) 동일 패턴 + 세션 없으면 throw. `flushQueue`: 400/401/403/PGRST 등 영구 실패는 즉시 give-up | 100% |
| 2026-06-28 | 오프라인 정리1+2 | `flushQueue` 영구실패 검출 강화 + `getUser→getSession` 클라이언트 일괄 — `withQueue.extractErrorSignature`로 PostgrestError 같은 plain object 에러의 code/status/details/hint 추출(‘unknown’으로 잡혀 무한 retry되던 케이스 차단) + 영구 fail 정규식 보강(invalid input syntax/null value/not null) · 클라이언트 12개 파일(home/_client·settings·HomeClient·PlanDetailPanel·PlanFormModal·QuickCaptureModal·useFolders·useGraphData·usePlanner·currentUser·scheduler 등) `getUser()`→`getSession()` 일괄 전환(서버 라우트는 보안상 유지) · ※편집 중 `usePlanner.ts` truncation 손상 발생 → HEAD 원본으로 복원 후 빌드 검증 | 100% |
| 2026-06-28 | 오프라인 후속 정리 | `emptyTrash` getUser→getSession(정리 잔여) + flush idMap swap을 LS 캐시까지 전파 + give-up 시 stale 정리 — `lib/sync/cacheCleanup.ts` 신규(`applyIdSwapToLocalStorage`/`removeTempIdsFromCaches`) · `broadcast` SyncEvent `queue-giveup` 추가 · `withQueue` GaveUpEntry · `SyncBootstrap` applyGaveUp + LS swap · `useBroadcastListener` queue-giveup case (dev 커밋 9cd2c83·f683d3b) | 100% |
| 2026-06-28 | PR-M1-C 이미지 큐화 | 이미지 첨부 R2 오프라인 큐화 — `queueDB` v3(image-upload op + image_blobs store + 6 helpers) · `withQueue` v3(`uploadImageOrQueue` + flushQueue 2-라운드: image→content swap→나머지) · `imageSwap.ts` 신규(`swapImageNodesInContent`) · `broadcast` image-swap 이벤트 · `cacheCleanup.applyImageSwapToCaches` + `memoStore.lastImageSwap` notify · `ResizableImageView` localBlobId 시 IDB blob URL 표시 · `MemoEditor` Image addAttributes localBlobId + uploadImageOrQueue + lastImageSwap 구독해 Tiptap attrs 갱신 · `EditorToolbar` 차단 토스트 제거 + uploadImageOrQueue (dev 커밋 b3c1c60) | 100% |
| 2026-06-28 | truncation 방지 도구 | `scripts/verify-changes.sh` 추가(null/끝/큰deletion/tsc 4단계 자동 검증, force-add) + CLAUDE.md §6 검증 스크립트 사용법 추가 — Edit/Write 도구로 큰 파일 편집 시 끝부분 잘림 재발 방지 (`docs/pr-m1c-apply-guide.md`는 /docs/ gitignore로 로컬 유지) | 100% |
| 2026-06-29 | 홈 stale 메모 race fix | 메모 삭제 후 홈 최근 메모 stale — `softDelete`의 `home-memos` invalidate가 supabase read-after-write replication lag(~1초)와 만나 stale 5개 fetch→setQueryData→useEffect→LS stale write→F5 후에도 잔존(오프라인 작성 메모 삭제 시 flush+swap 직후라 노출 빈도↑). `useMemos.softDelete` invalidate 제거(setQueryData+LS 청소만) + `useBroadcastListener` memo-delete도 같은 패턴으로 보강(cross-tab race 차단) | 100% |
| 2026-06-28 | PR-M1-B 오프라인 작성+본문 | queueDB v2 (op 4종 `update`/`memo-insert`/`plan-insert`/`memo-body-update` + `id_map` store + `makeTempId`/`isTempId`/`recordIdMapping`/`resolveTempId`/`enqueueBodyOverwrite`), withQueue v2 (`createMemoOrQueue`/`createPlanOrQueue`/`updateMemoBodyOrQueue` + `flushQueue` op별 분기 + tempId→realId 자동 매핑), memoStore.swapId / plannerStore.swapPlanId, SyncBootstrap `applyIdMappings` (zustand+RQ 캐시 swap + URL silent 교체 + 멀티탭 broadcast invalidate), `useMemos.createMemo`/`usePlanner.createPlan`/`MemoEditor.save`(insert+update 분기) 큐 경유, 이미지 첨부 오프라인 차단 토스트(MemoEditor·EditorToolbar) — tsc+ESLint 통과 | 100% |
| 2026-07-04 | 그래프 물리 쏠림 수정 | 노드·링크 증가 시 한쪽 쏠림 원인 4종 제거 — ①forceCenter(무게중심 평행이동)+고정노드(fx/fy) 조합의 tick당 편향 누적 → 노드별 개별 인력 forceX/forceY로 교체(`setCenterForceStrength` 헬퍼) ②시뮬 sleep 시 위키/태그 허브 자동 fx/fy 핀 3곳 제거 ③드래그 후 영구 핀 → 놓으면 해제(`releaseDragNode`, 옵시디언 방식) ④charge 허브 배율 무한비례 → sqrt+상한 3배+`distanceMax(500)`. 링크 strength `1/min(deg)` d3 표준형, alphaDecay 0.1→0.03, velocityDecay 0.55→0.45, collide 반경 (+4) 통일, 기존 forceCenter 무게중심 정렬 보정 로직 삭제(불필요). verify-changes.sh+tsc+ESLint 통과 | 100% |
| 2026-07-04 | 그래프 월드중심 고정 | 프리셋/캐시발 잔여 쏠림 제거 — 물리 월드 중심을 (0,0)으로 완전 고정하고 화면 정렬은 카메라(transform)가 담당(Obsidian 방식): forceX/Y(0) 고정 + 시뮬 마운트 1회 생성(리사이즈 재생성 제거), ResizeObserver 첫 실측 시 카메라 원점 중앙 정렬(`cameraInitRef`), 프리셋 재배치를 뷰포트 중심 → 월드 원점 기준으로 + 카메라 재조준(줌 유지) — 기존엔 배치점과 중심력 목표점이 어긋나 전체가 한 방향으로 흘렀음, 레이아웃 캐시 v1→v2(구 코드의 쏠린 좌표 무효화), 리셋도 원점 기준. verify-changes.sh+tsc+ESLint+next build 통과 | 100% |
| 2026-07-04 | 프리셋 배치 각도 편향 제거 | 프리셋 재배치의 단일 회전 나선(angle=i/N·2π)이 linkCount 정렬과 결합해 허브가 전부 동쪽(각도 0 부근)에 심어짐 → 링크 인력이 연결 덩어리를 북동으로 끌던 방향성 몰림 + 저연결 노드 초승달 호 잔상. 황금각 phyllotaxis 배치로 교체(`GOLDEN_ANGLE=π(3-√5)`, r=R·√(i/N)) — 각도 편향 0, 허브 안쪽·leaf 바깥 균등 밀도 disc. 프리셋 effect + nodes 업데이트 초기 링 배치 2곳 적용. verify-changes.sh+tsc+next build 통과 | 100% |
| 2026-07-04 | fit-to-view + 응집형 튜닝 | 프리셋/리셋 후 시뮬 안정 시 전체 노드 bbox가 화면에 들어오도록 자동 카메라 이동+줌(`fitToView`, ease-out 30f, k 0.08~2.5, 패딩 15%) — `fitPendingRef` 예약 후 RAF sleep 분기 3곳에서 발동, `fitToViewRef` 패턴으로 stale closure 회피. 응집형 프리셋 체감 조밀도 강화(centerTension 5→6, repulsion 3→2, linkDistance 3→2). tsc+ESLint(신규 0)+next build 통과 | 100% |
| 2026-07-04 | 그래프 UX — 호버/검색 하이라이트 | 호버 노드+이웃 강조·나머지 디밍(hoveredNodeIdRef, mousemove 리렌더 없음), 호버 링(옅은 보라), 포커스 노드·이웃 라벨 줌 무관 표시, 검색 비매칭 디밍 + 현재 매칭 앰버 링. PR #281 프로덕션 라이브 검증 완료 | 100% |
| 2026-07-04 | 보안 P0 — OAuth state 서명 | `lib/security/oauthState.ts` (HMAC-SHA256 서명 + 10분 만료 + timingSafeEqual), calendar/drive auth 라우트에서 서명 state 발급, callback에서 검증 후 내부 user_id만 사용 — state 평문 user_id 무검증 신뢰로 인한 연동 탈취(임의 user_id로 토큰 등록) 차단 | 100% |
| 2026-07-04 | 보안 P0 — AI rate limiting | `lib/security/rateLimit.ts` + `supabase/migrations/0016_api_rate_limit.sql` (api_usage 테이블 + increment_api_usage SECURITY DEFINER RPC, 원자적 upsert). AI 5개 라우트 일일 한도: chat 300 / insights 40 / report 40 / analyze-profile 30 / profile-insight 60. 캐시 히트는 미카운트(실제 Anthropic 호출 직전 검사), RPC 미배포 시 fail-open. chat 메시지 4,000자 제한. **Supabase에 0016 마이그레이션 실행 필요** | 100% |
| 2026-07-04 | CI 파이프라인 | `.github/workflows/ci.yml` — PR(main/dev)·push(dev) 시 npm ci + null byte 무결성 검사 + `npm run lint` + `tsc --noEmit`. next build는 Vercel preview 빌드가 담당(중복 제거) | 100% |

---

## DB 추가 작업 (Supabase에서 직접 실행 필요)

```sql
-- wiki_links 컬럼 추가 (그래프 뷰 필요)
ALTER TABLE memos ADD COLUMN IF NOT EXISTS wiki_links text[] DEFAULT '{}';

-- 업로드 파일 관리 테이블 (R2 연동)
CREATE TABLE IF NOT EXISTS uploaded_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users NOT NULL,
  memo_id uuid REFERENCES memos(id) ON DELETE SET NULL,
  r2_key text NOT NULL,
  public_url text NOT NULL,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  original_size integer NOT NULL,
  compressed_size integer NOT NULL,
  saved_percent integer NOT NULL,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE uploaded_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY "files: 본인만 접근" ON uploaded_files FOR ALL USING (auth.uid() = user_id);
CREATE INDEX idx_uploaded_files_user ON uploaded_files(user_id);

-- AI 2트랙 (supabase/chat_rooms_profile.sql 전체 실행)
-- chat_rooms, chat_messages, user_profiles, profile_history 테이블
-- 파일 위치: supabase/chat_rooms_profile.sql

-- RFC 5545 RRULE 컬럼 (#8 반복 옵션 확장)
ALTER TABLE plans ADD COLUMN IF NOT EXISTS rrule_str text;
-- 기존 repeat_type/repeat_end_date는 그대로 유지 (legacy fallback)

-- Web Push (#6-B — 백그라운드 알림)
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users NOT NULL,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, endpoint)
);
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "push_subs: 본인만" ON push_subscriptions FOR ALL USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id);

CREATE TABLE IF NOT EXISTS plan_notifications_sent (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users NOT NULL,
  plan_id uuid NOT NULL,
  plan_date date NOT NULL,
  sent_at timestamptz DEFAULT now(),
  UNIQUE(plan_id, plan_date)
);
ALTER TABLE plan_notifications_sent ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notif_sent: 본인만" ON plan_notifications_sent FOR ALL USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_notif_sent_lookup ON plan_notifications_sent(user_id, plan_date);

-- AI rate limiting (supabase/migrations/0016_api_rate_limit.sql 전체 실행 필요)
-- api_usage 테이블 + increment_api_usage(p_bucket, p_limit) SECURITY DEFINER RPC
-- 미실행 시 rate limit은 fail-open (허용 + 콘솔 로그)으로 동작

-- Postgres FTS (#9 — 메모 서버 검색)
ALTER TABLE memos ADD COLUMN IF NOT EXISTS search_vec tsvector;

CREATE OR REPLACE FUNCTION memos_search_vec_update() RETURNS trigger AS $$
BEGIN
  NEW.search_vec :=
    setweight(to_tsvector('simple', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW.content_text, '')), 'B') ||
    setweight(to_tsvector('simple', array_to_string(coalesce(NEW.tags, '{}'), ' ')), 'A') ||
    setweight(to_tsvector('simple', array_to_string(coalesce(NEW.wiki_links, '{}'), ' ')), 'A');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER memos_search_vec_trg
BEFORE INSERT OR UPDATE OF title, content_text, tags, wiki_links ON memos
FOR EACH ROW EXECUTE FUNCTION memos_search_vec_update();

CREATE INDEX IF NOT EXISTS idx_memos_search_vec ON memos USING gin(search_vec);

-- 기존 데이터 backfill (트리거 발화)
UPDATE memos SET title = title;
```

---

## 배포 전 필수 체크리스트 (재발 방지)

Vercel 빌드 실패는 대부분 다음 두 가지 손상 패턴이다. dev push 전에 **반드시** 확인:

### 1. 파일 null byte 검사 (CSS 손상 = 빌드 실패)
```bash
# 모든 추적 파일에서 null byte 검출 — 발견 시 즉시 fix
git ls-files | xargs -I{} sh -c 'grep -lq $"\x00" "{}" 2>/dev/null && echo "NULL: {}"'

# 또는 globals.css만 빠르게
python -c "print('nulls:', open('src/app/globals.css','rb').read().count(b'\x00'))"
```
- 발견 시 `python -c "import sys; sys.stdout.buffer.write(open('FILE','rb').read().replace(b'\x00',b''))" > FILE.clean && mv FILE.clean FILE`
- 가장 자주 손상되는 파일: `src/app/globals.css`, `src/components/memo/MemoEditor.tsx`, `EditorToolbar.tsx`, `MemoList.tsx`, `ResizableImageView.tsx`

### 2. 파일 끝 잘림 검사
```bash
# CSS는 닫는 } 가 있어야 정상
tail -3 src/app/globals.css
# tsx는 마지막에 } 또는 ) 또는 ;로 끝나야 정상
for f in $(git ls-files '*.tsx'); do
  tail -1 "$f" | grep -qE '[}\)\;]\s*$' || echo "TRUNCATED: $f"
done
```

### 3. tsc + next build 둘 다 검증
- `npx tsc --noEmit` 통과 = 타입만 OK (필요조건)
- `npm run build` 통과 = 진짜 빌드 OK (충분조건)
- tsc만 보고 push하면 CSS·SSR·Server Component 에러를 놓침

### 4. CSS modern feature는 보수적으로
- `:has()` 셀렉터는 Vercel CSS 파이프라인(lightningcss 등 환경에 따라)에서 빌드 실패 가능 → JS 레벨로 처리하거나 fallback 클래스로 대체

### 5. 큰 파일 편집 시 손상 방지 패턴
500줄 이상 파일을 수정할 때는 **반드시** python 스크립트로:
```python
import subprocess
base = subprocess.run(['git','show','HEAD:PATH'], capture_output=True, text=True).stdout
new = base.replace(OLD, NEW)
assert '\x00' not in new
with open('PATH','wb') as f: f.write(new.encode('utf-8'))
```
Edit/Write 도구로 큰 파일(MemoEditor·EditorToolbar·MemoList·globals.css)을 직접 수정하면 끝부분이 잘리거나 null byte가 섞이는 패턴이 반복됨.

### 6. 편집 후 자동 검증 스크립트 (truncation 방지)

Edit/Write/sed 등으로 파일을 수정한 뒤에는 **반드시** 검증 스크립트를 돌린다. 실제로 `usePlanner.ts`가 함수 중간에서 잘려 EOF가 되는 truncation이 재발한 적이 있음(2026-06-28).

```bash
# 변경된 모든 파일 자동 검증 (null byte / 파일 끝 정상성 / 큰 deletion 경고 / tsc)
bash scripts/verify-changes.sh

# 특정 파일만
bash scripts/verify-changes.sh src/lib/sync/withQueue.ts src/hooks/useMemos.ts
```

검사 4단계:
1. **null byte 0개** — CSS/TSX 손상의 주원인
2. **파일 끝 정상성** — TS는 `}`/`)`/`;`/`]`, CSS는 `}`, JSON은 `}`/`]`로 끝나야 함 (아니면 truncation 의심)
3. **HEAD 대비 큰 deletion(-50L+) 경고** — 의도치 않은 잘림 탐지
4. **tsc --noEmit** 통과

> Edit/Write 도구의 구조적 한계: 큰 파일을 직접 수정하면 끝부분 잘림·null byte 혼입이 반복되므로, 도구로 편집했더라도 이 스크립트로 한 번 더 확인한 뒤 commit/push 한다. 손상 발견 시 `git show HEAD:PATH` 원본에서 잘린 부분을 복원.

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
