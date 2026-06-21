-- ─────────────────────────────────────────────────────────────────────────
-- 0008_extra_cascade.sql
-- ─────────────────────────────────────────────────────────────────────────
-- 0007 검증 중 발견된 누락 테이블 2개의 user_id FK를 CASCADE로 재설정.
--
-- - backup_logs                 : 자동 백업 로그
-- - recurring_plan_completions  : RRULE 인스턴스 완료 추적
--
-- 0001_baseline에 정의가 빠져 있던 테이블. 0009에서 baseline에 합칠 예정.
-- 우선 cascade부터 잡아 계정 삭제 시 FK 위반 방지.
-- ─────────────────────────────────────────────────────────────────────────

-- 헬퍼 (0007과 동일 패턴)
CREATE OR REPLACE FUNCTION _rebind_user_fk(
  p_table text,
  p_column text DEFAULT 'user_id',
  p_on_delete text DEFAULT 'CASCADE'
) RETURNS void AS $$
DECLARE
  constraint_name text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = p_table
  ) THEN
    RAISE NOTICE '⊘ 테이블 없음, skip: %', p_table;
    RETURN;
  END IF;

  SELECT tc.constraint_name INTO constraint_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
   AND tc.table_schema = kcu.table_schema
  WHERE tc.table_schema = 'public'
    AND tc.table_name = p_table
    AND tc.constraint_type = 'FOREIGN KEY'
    AND kcu.column_name = p_column
  LIMIT 1;

  IF constraint_name IS NULL THEN
    RAISE NOTICE '⊘ FK 없음, skip: %.%', p_table, p_column;
    RETURN;
  END IF;

  EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', p_table, constraint_name);
  EXECUTE format(
    'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I)
       REFERENCES auth.users(id) ON DELETE %s',
    p_table, constraint_name, p_column, p_on_delete
  );
  RAISE NOTICE '✓ % FK 재설정: % ON DELETE %', p_table, p_column, p_on_delete;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  PERFORM _rebind_user_fk('backup_logs',               'user_id', 'CASCADE');
  PERFORM _rebind_user_fk('recurring_plan_completions','user_id', 'CASCADE');
END $$;

DROP FUNCTION IF EXISTS _rebind_user_fk(text, text, text);

-- 검증
DO $$
DECLARE no_action_count int;
BEGIN
  SELECT COUNT(*) INTO no_action_count
  FROM information_schema.referential_constraints rc
  JOIN information_schema.table_constraints tc
    ON rc.constraint_name = tc.constraint_name
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
  WHERE kcu.column_name = 'user_id'
    AND tc.table_schema = 'public'
    AND rc.delete_rule != 'CASCADE'
    AND tc.table_name IN ('backup_logs', 'recurring_plan_completions');

  IF no_action_count > 0 THEN
    RAISE EXCEPTION '0008 검증 실패: 여전히 NO ACTION 상태인 테이블이 % 개', no_action_count;
  END IF;
  RAISE NOTICE '0008 적용 완료 — backup_logs, recurring_plan_completions 모두 CASCADE';
END $$;
