# [2/3] 소스 파일 인프라 — PDF·긴 이미지 원본 직접 업로드 · 원본 다운로드(웹/앱) · GC 보호

> 1단계(`feat/pdf-note` 브랜치, 정규화 커밋) 완료 후 진행. 이 단계는 AI 없이 "PDF 1개 또는 이미지 여러 장을 **원본 그대로** 안전하게 올리고, 노트에 묶고, 언제든 원본 이름으로 다시 받는" 인프라만 만든다.

## 0. 사전 점검 (필수)

1. `git status` clean + 현재 브랜치 `feat/pdf-note` + `git log -1`이 1단계 정규화 커밋인지 확인. 아니면 멈추고 보고.
2. CLAUDE.md 코딩 컨벤션(특히 **토스트 원칙**), GAP 원칙, 배포 전 체크리스트 숙지.

## 1. 배경 — 현재 구조의 함정 (코드 분석 결과)

| # | 함정 | 근거 |
|---|---|---|
| ① | **Vercel 함수 요청/응답 본문 4.5MB 제한.** `/api/upload`는 PDF 50MB·이미지 20MB를 허용하지만 프로덕션에선 4.5MB 초과 파일이 서버에 도달 못 함. 다운로드도 서버 경유 스트리밍이면 같은 제한 | `src/app/api/upload/route.ts` |
| ② | **기존 이미지 압축이 긴 이미지를 파괴.** `compressImage`가 `resize(1920, 9600, fit:'inside')` → 1080×20000 캡처가 **가로 518px**로 축소돼 글자 판독 불가 | `src/lib/r2/compress.ts` |
| ③ | R2 키가 UUID + 공개 URL이 다른 출처(r2.dev) → `<a download>` 무시, 받은 파일명이 UUID | `src/lib/r2/upload.ts`, `client.ts` |
| ④ | R2 GC 크론은 "본문에 URL 있음" 또는 "`memo_id`가 **활성** 메모"만 보존(7일 경과분 대상). 휴지통 메모(`is_deleted=true`)는 `activeMemoIds`에서 빠져 있어 **휴지통 노트의 원본이 삭제될 수 있음** (주석은 "휴지통 제외"라 되어 있으나 코드상 확인 필요) | `src/app/api/cron/r2-gc/route.ts` |
| ⑤ | `uploaded_files.memo_id`는 파일→메모 1:1. **이미지 여러 장 → 노트 1개**, 같은 이미지가 여러 노트에 쓰이는 경우를 표현 못 함 | `0001_baseline.sql` |

설계 원칙:
- **바이트는 서버를 거치지 않는다** (브라우저 ↔ R2 presigned URL 직접). 서버는 권한 확인·메타데이터·썸네일만.
- **소스 파일은 원본 무손실 보존** (압축·리사이즈 금지). 표시용 썸네일만 별도 생성.

## 2. 지원 범위

| 종류 | 허용 형식 | 1회 업로드 단위 | 파일당 최대 |
|---|---|---|---|
| PDF | `application/pdf` | 1개 | 50MB |
| 이미지 | `image/png`, `image/jpeg`, `image/webp` | 1~20장 (한 노트로 묶음) | 30MB |

- PDF와 이미지를 **한 세트에 섞지 않는다** (1차).
- HEIC는 1차 미지원 → "갤러리에서 JPG로 공유하거나 캡처 이미지를 선택해 주세요" 안내.

## 3. 패키지 · 외부 설정

1. `npm i @aws-sdk/s3-request-presigner` — 기존 `@aws-sdk/client-s3`와 **같은 버전**으로 (package-lock 확인).
2. `npm i fflate` — 여러 원본 "전체 받기(zip)"용, 클라이언트 동적 import.
3. **R2 버킷 CORS** (브라우저 → R2 PUT, zip용 GET 허용). 먼저 기존 R2 자격증명으로 S3 `GetBucketCors` → 병합 → `PutBucketCors`를 수행하는 1회성 스크립트(`scripts/set-r2-cors.ts`) 실행. 허용 출처: `http://localhost:3000` + **프로덕션 도메인**(Vercel 설정/환경변수에서 확인, 불명확하면 나에게 질문):
   ```json
   [{
     "AllowedOrigins": ["http://localhost:3000", "https://<프로덕션 도메인>"],
     "AllowedMethods": ["PUT", "GET", "HEAD"],
     "AllowedHeaders": ["content-type"],
     "ExposeHeaders": ["ETag", "Content-Disposition"],
     "MaxAgeSeconds": 3600
   }]
   ```
   - `AccessDenied`면 멈추고 **Cloudflare 대시보드 → R2 → 버킷 → Settings → CORS Policy**에 위 JSON을 붙여넣으라고 안내 후 내가 완료라고 할 때까지 대기.

## 4. DB 마이그레이션 (`supabase/migrations/`의 다음 번호)

```sql
-- 소스 파일 메타
ALTER TABLE uploaded_files
  ADD COLUMN IF NOT EXISTS is_source boolean NOT NULL DEFAULT false,  -- 원본 보존 소스 파일 (압축 안 함)
  ADD COLUMN IF NOT EXISTS image_width integer,
  ADD COLUMN IF NOT EXISTS image_height integer,
  ADD COLUMN IF NOT EXISTS page_count integer;

-- 노트 ↔ 소스 파일 N:M (이미지 여러 장 → 노트 1개, 순서 보존)
CREATE TABLE IF NOT EXISTS memo_sources (
  memo_id  uuid NOT NULL REFERENCES memos(id) ON DELETE CASCADE,
  file_id  uuid NOT NULL REFERENCES uploaded_files(id) ON DELETE CASCADE,
  user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (memo_id, file_id)
);
ALTER TABLE memo_sources ENABLE ROW LEVEL SECURITY;
-- 정책: 본인만 (기존 uploaded_files 정책 스타일)
CREATE INDEX IF NOT EXISTS idx_memo_sources_file ON memo_sources(file_id);
```
- 기존 마이그레이션 스타일(헤더 주석 + DO 블록 검증) 준수 → Supabase 적용 → CLAUDE.md "DB 추가 작업"·스키마 섹션 기록.
- 계정 삭제 cascade 마이그레이션(0007/0008)과 일관되는지 확인.

## 5. 서버 API

### 5-1. `POST /api/files/presign`
- 입력: `{ files: [{ fileName, size, mimeType, contentHash }] }` (contentHash = 클라이언트 SHA-256 hex). PDF면 1개, 이미지면 1~20개.
- 검증: 인증 / 형식·개수·크기(2장 표) / 해시 형식 / 세트 내 형식 혼합 금지.
- 파일별 **멱등**: `(user_id, content_hash)` 존재 시 업로드 생략 → `{ deduplicated: true, fileId, linkedMemos: [{ id, title, inTrash }] }` (memo_sources 기준, 영구 삭제된 메모 제외).
- quota: 기존 `getUserStorage` — 신규 파일 합계로 검사, 초과 시 413 (기존 문구 재사용).
- 신규 파일: 키 `${userId}/files/${uuid}.${ext}` + presigned PUT(10분, 정확한 `ContentType`, `CacheControl: 'public, max-age=31536000'`) → `{ uploadUrl, key }`.

### 5-2. `POST /api/files/complete`
- 입력: `{ key, fileName, size, contentHash }` (파일별 호출)
- 검증: `key`가 `${user.id}/files/`로 시작 / `HeadObject` 존재·크기 일치 / 매직바이트(`GetObject Range: bytes=0-15`, 기존 `matchesMagicBytes` 재사용). 실패 시 **R2 객체 삭제 후 400**.
- 이미지: R2에서 원본을 받아 `sharp(...).metadata()`로 `image_width/height` 기록 + **썸네일만** 생성(`compressThumbnail` 재사용, 키 `thumb_${uuid}.webp`, `thumbnail_url`에 저장). 원본은 **절대 재인코딩하지 않음**. `limitInputPixels`를 세로 긴 이미지(예: 1440×40000)가 통과하도록 설정.
- `uploaded_files` insert: `is_source = true`, `public_url`, `file_name`(한글 원본명), `mime_type`, `original_size = compressed_size = size`, `saved_percent = 0`, `content_hash`, 치수.
  - UNIQUE 충돌(경합) → 방금 올린 객체 삭제 후 기존 row 반환.
- 반환: `{ fileId, url, thumbnailUrl, width?, height? }`

### 5-3. `GET /api/files/[id]/download?mode=inline|attachment`
- 인증 → 본인 row 조회(없으면 404) → presigned GET(60초):
  - `ResponseContentType: mime_type`
  - `ResponseContentDisposition: ${mode}; filename="${ASCII 폴백}"; filename*=UTF-8''${encodeURIComponent(file_name)}` (**RFC 5987**, 한글명 보존, 폴백은 비ASCII→`_` + 확장자 보장)
- `302`, `Cache-Control: no-store`. `mode` 기본 `attachment`.

### 5-4. 공용
- 모든 라우트 `runtime = 'nodejs'`, try-catch, 한국어 에러 JSON. 서명 헬퍼는 `src/lib/r2/presign.ts`.
- **기존 `/api/upload`(에디터 이미지 첨부)는 변경하지 않는다** — 소스 파일만 새 경로.

## 6. 클라이언트

### 6-1. `src/lib/files/uploadSources.ts`
```ts
export async function uploadSources(files: File[], opts?: {
  onProgress?: (overallPct: number, perFile: number[]) => void
  signal?: AbortSignal
}): Promise<Array<{ fileId: string; deduplicated: boolean; linkedMemos: { id: string; title: string; inTrash: boolean }[]; thumbnailUrl?: string | null }>>
```
- SHA-256: `crypto.subtle.digest` / presign 일괄 → **XMLHttpRequest PUT**(진행률, 동시 3개), `Content-Type` 헤더 서명과 일치 → complete.
- 결과 배열은 **입력 순서 유지**.
- 오프라인이면 즉시 에러 "오프라인에서는 파일을 올릴 수 없어요".

### 6-2. 원본 카드 `src/components/memo/SourceFileBar.tsx`
- ⚠️ 본문 링크로 만들지 않는다: 에디터 Link 확장이 `openOnClick: false`라 **본문 링크는 클릭해도 열리지 않음**.
- `memo_sources`(position 순) + `uploaded_files` 조인 조회(RLS). 소스가 없으면 아무것도 렌더하지 않음(로딩 중에도 렌더 안 함 — 레이아웃 시프트 방지).
- PDF 1개:
  ```
  📄 행동경제학_입문.pdf · 32쪽 · 2.4MB        [열기] [다운로드]
  ```
- 이미지 N장: 가로 스크롤 썸네일 스트립(세로로 긴 이미지는 상단 크롭 썸네일) + `이미지 5장 · 합계 12.8MB`
  - 썸네일 탭 → 원본 보기(`mode=inline` 새 탭 — 긴 이미지도 원본 해상도로 스크롤 가능)
  - 각 썸네일 롱프레스/hover 메뉴 → 다운로드
  - `[전체 받기]`(2장 이상): fflate로 클라이언트 zip — `/api/files/{id}/download?mode=inline` fetch(리다이렉트 → R2, CORS GET 허용 필요) → `{노트제목}_원본.zip`. 파일명 충돌 시 `(2)` 접미사, 순서 접두사 `01_`.
- 열기: `window.open('/api/files/{id}/download?mode=inline', '_blank', 'noopener')` / 다운로드: 동일 출처 `<a href=".../download">` click (Android PWA에서 알림바 다운로드).
- 오프라인이면 버튼 비활성 + 툴팁.
- 배치: 메모 페이지(`src/app/(main)/memo/[id]/_client.tsx`)에서 렌더. 정렬이 어색하면 **`MemoEditor`에 `headerSlot?: ReactNode` prop 하나만** 추가해 헤더 아래에 꽂는다 (그 외 MemoEditor 변경 금지). 모바일 `px-5` 여백·다크모드·`design-system/pages/memo-editor.md` 준수. 아이콘 lucide `FileText`, `Image`, `ExternalLink`, `Download`, `FolderDown`.

## 7. GC 보호 — `src/app/api/cron/r2-gc/route.ts`

1. 먼저 현재 동작을 **읽고 보고**: 휴지통 메모에 연결된 파일이 보존되는지.
2. 가드 추가:
   - `memo_sources`에 **존재하는 메모(활성+휴지통)**와 연결된 파일 → 보존 (`keptBy.sourceLink`)
   - `memo_id`가 휴지통 메모인 파일 → 보존 (`keptBy.trashLink`) — 이미지에도 해당하는 **기존 버그 수정**일 수 있으니 이력에 명확히 기록
   - 영구 삭제 시 `memo_sources`는 CASCADE로 사라지고 → 기존 로직대로 orphan 처리
   - 조회 실패 시 해당 사용자 GC 스킵(fail-safe, 기존 스타일)
3. `is_source` 파일 삭제 시 `thumbnail_url` 변형도 함께 삭제되는지 확인.

## 8. 검증

1. `bash scripts/verify-changes.sh` → `npx tsc --noEmit` → `npx next build`
2. 업로드 UI는 3단계에서 만들므로 **커밋하지 않는 임시 버튼**으로 확인 (검증 후 반드시 제거):
   - 10MB 이상 PDF / 5MB 이상 긴 PNG 캡처(예: 1080×15000) 업로드 성공 → **R2 원본이 바이트 단위로 동일**(해시 비교)하고 가로가 줄지 않았는지
   - 이미지 5장 동시 업로드 → 순서 유지, 진행률 동작
   - 같은 파일 재업로드 → `deduplicated: true`
   - 확장자만 위장한 가짜 파일 → 400 + R2 객체 삭제
   - 테스트 메모에 `memo_sources` 수동 연결 → SourceFileBar: 열기 / 개별 다운로드(**한글 원본 파일명**) / 전체 받기 zip
3. GC: `/api/cron/r2-gc?dryRun=1` (CRON 인증 헤더) → 휴지통 메모·memo_sources 연결 파일이 kept로 잡히는지 결과 JSON 보고
4. 테스트 데이터(메모·uploaded_files·memo_sources·R2 객체) 정리

## 9. 마무리

- GAP 분석 99% 이상.
- CLAUDE.md: 폴더 구조·스키마·작업 이력. 백로그 추가: "**에디터 첨부(`/api/upload`)는 4.5MB 초과 시 프로덕션 실패** — presigned 이관 필요", "HEIC 소스 지원".
- 커밋: `feat: 소스 파일 원본 직접 업로드(PDF·이미지)·원본 다운로드·memo_sources·GC 보호` — diff 대조.
- push 금지. 보고: 변경 파일, CORS 적용 방식, 원본 무손실 확인 결과, GC dryRun 결과.
