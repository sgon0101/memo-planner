-- ─────────────────────────────────────────────────────────────────────────
-- 0006_updated_at_triggers.sql
-- ─────────────────────────────────────────────────────────────────────────
-- 목적:
--   모든 운영 테이블의 updated_at을 DB 트리거로 강제 갱신.
--
-- 왜 필요한가:
--   - PR-4 (optimistic locking) 작동의 전제 조건.
--     클라이언트가 updated_at을 빠뜨리거나 임의로 넘기지 못하도록 DB가 단일 출처를 책임짐.
--   - 향후 모든 conflict 감지 / Realtime / 캐시 무효화 시점 판정의 기준이 됨.
--
-- 적용 영향:
--   - 기존 row에 영향 없음. UPDATE가 발생할 때마다 updated_at이 now()로 갱신됨.
--   - 클라이언트가 updated_at을 명시적으로 넘겨도 트리거가 덮어씀(의도).
--
-- 롤백:
--   DROP TRIGGER + DROP FUNCTION 으로 되돌릴 수 있음 (파일 하단 ROLLBACK 섹션 참고).
-- ─────────────────────────────────────────────────────────────────────────

-- 1. 함수
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. 트리거 일괄 등록 — updated_at 컬럼이 있는 모든 테이블
DO $$
DECLARE
  t text;
  tables_with_updated_at text[] := ARRAY[
    'folders',
    'memos',
    'plans',
    'plan_templates',
    'user_integrations',
    'user_profiles',
    'chat_rooms',
    'push_subscriptions'
  ];
BEGIN
  FOREACH t IN ARRAY tables_with_updated_at LOOP
    -- 테이블이 존재할 때만 트리거 설치 (신규 환경 안전성)
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS %I_touch_updated_at ON %I', t, t);
      EXECUTE format(
        'CREATE TRIGGER %I_touch_updated_at
           BEFORE UPDATE ON %I
           FOR EACH ROW EXECUTE FUNCTION touch_updated_at()',
        t, t
      );
      RAISE NOTICE '✓ touch_updated_at 트리거 등록: %', t;
    ELSE
      RAISE NOTICE '⊘ 테이블 없음, skip: %', t;
    END IF;
  END LOOP;
END $$;

-- 3. 검증 — 등록된 트리거 목록 출력
DO $$
DECLARE
  trigger_count int;
BEGIN
  SELECT COUNT(*) INTO trigger_count
  FROM pg_trigger
  WHERE tgname LIKE '%_touch_updated_at'
    AND NOT tgisinternal;
  RAISE NOTICE '0006 적용 완료 — touch_updated_at 트리거 % 개 등록됨', trigger_count;
END $$;

-- ─────────────────────────────────────────────────────────────────────────
-- ROLLBACK (필요 시 별도 실행)
-- ─────────────────────────────────────────────────────────────────────────
-- DO $$
-- DECLARE t text;
-- BEGIN
--   FOREACH t IN ARRAY ARRAY[
--     'folders','memos','plans','plan_templates',
--     'user_integrations','user_profiles','chat_rooms','push_subscriptions'
--   ] LOOP
--     EXECUTE format('DROP TRIGGER IF EXISTS %I_touch_updated_at ON %I', t, t);
--   END LOOP;
-- END $$;
-- DROP FUNCTION IF EXISTS touch_updated_at();
