# supabase/migrations

Weave DB 스키마의 단일 출처(source of truth).
모든 스키마 변경은 이 디렉터리에 새 파일을 추가하는 방식으로만.

## 파일 명명 규칙

`NNNN_짧은_설명.sql` — 4자리 zero-pad 순번.
순번이 곧 적용 순서. **중간 번호 비우거나 재사용 금지.**

## 현재 파일 목록

| 번호 | 파일 | 역할 |
|---|---|---|
| 0001 | `0001_baseline.sql` | 운영 중인 모든 테이블 idempotent 정의 |
| 0002 | `0002_chat_rooms_profile.sql` | AI 2트랙 (대화방·메시지·프로필) |
| 0003 | `0003_embeddings_pgvector.sql` | pgvector + match_memos RPC |
| 0004 | `0004_plan_templates_extend.sql` | 플랜 템플릿 풀스펙 확장 |
| 0005 | `0005_snooze.sql` | plan_notifications_sent.snoozed_until |
| 0006 | `0006_updated_at_triggers.sql` | **신규** — updated_at 자동 갱신 |
| 0007 | `0007_user_cascade_delete.sql` | **신규** — user 종속 FK CASCADE |

0001~0005는 운영 DB에 이미 적용된 상태를 그대로 재현(idempotent).
0006, 0007이 PR-1에서 새로 추가되는 안전망.

## 적용 방법

### 1. Supabase CLI 설치 (없을 때만)

```powershell
npm install -g supabase
# 또는: scoop install supabase
supabase --version
```

### 2. 원격 프로젝트 연결 (한 번만)

```powershell
# project ref는 Supabase 대시보드 > Project Settings > General > Reference ID
supabase link --project-ref <YOUR_PROJECT_REF>
```

비밀번호 물어보면 DB password 입력.

### 3. Dry-run으로 변경분 확인

```powershell
supabase db diff --linked
```

운영 DB와 마이그레이션의 차이를 보여줌. **0006, 0007이 신규로 잡혀야 정상.**

### 4. 적용

```powershell
supabase db push --linked
```

순번대로 0001~0007 적용. 0001~0005는 idempotent라 no-op.
실제 변경은 0006(트리거 등록), 0007(FK 재설정).

### 5. 검증

```powershell
# updated_at 트리거 확인
psql "<CONNECTION_STRING>" -c "
  SELECT tgname FROM pg_trigger WHERE tgname LIKE '%_touch_updated_at';
"

# CASCADE 적용 확인
psql "<CONNECTION_STRING>" -c "
  SELECT tc.table_name, rc.delete_rule
  FROM information_schema.referential_constraints rc
  JOIN information_schema.table_constraints tc
    ON rc.constraint_name = tc.constraint_name
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
  WHERE kcu.column_name = 'user_id'
    AND tc.table_schema = 'public'
  ORDER BY tc.table_name;
"
```

각 row의 `delete_rule`이 모두 `CASCADE`면 성공.

## 신규 환경 셋업

```powershell
supabase link --project-ref <NEW_REF>
supabase db push --linked
```

7개 파일이 순서대로 적용되어 운영 DB와 동일한 스키마 완성.

## 새 마이그레이션 추가하기

```powershell
supabase migration new 0008_short_name
```

빈 SQL 파일 자동 생성. idempotent로 작성:
- 테이블: `CREATE TABLE IF NOT EXISTS`
- 컬럼: `ADD COLUMN IF NOT EXISTS`
- 인덱스: `CREATE INDEX IF NOT EXISTS`
- 정책: `DROP POLICY IF EXISTS` → `CREATE POLICY`
- 트리거: `DROP TRIGGER IF EXISTS` → `CREATE TRIGGER`
- 제약: 이름 검색 후 DROP → ADD (0007 패턴 참고)

## 롤백

각 마이그레이션 파일 하단의 `ROLLBACK` 섹션 참고.
0006, 0007은 모두 안전 롤백 가능한 형태로 작성됨.

## _legacy/

운영 DB에 직접 실행됐던 원본 SQL 4개의 백업.
참조용. 신규 환경에서는 사용 금지(0002~0005 마이그레이션이 대체).
