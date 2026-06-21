-- ─────────────────────────────────────────────────────────────────────────
-- 0009_baseline_extra.sql
-- ─────────────────────────────────────────────────────────────────────────
-- 0001 작성 시 누락됐던 운영 테이블 2개를 baseline에 합류시킴.
--
-- - backup_logs                 : 자동 백업 실행 기록
-- - recurring_plan_completions  : RRULE 인스턴스 완료/스킵 추적
--
-- 운영 DB에 이미 존재하므로 IF NOT EXISTS로 no-op.
-- 신규 환경에서는 이 파일까지 적용해야 0001~0008과 동일한 스키마.
-- ─────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────
-- backup_logs — 자동 백업 실행 기록
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS backup_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  backup_type     text NOT NULL,                  -- 'manual' | 'auto'
  period          text NOT NULL,                  -- 'daily' | 'weekly' | 'monthly' | 'manual'
  total_count     integer NOT NULL,
  success_count   integer NOT NULL,
  failed_count    integer NOT NULL,
  drive_folder_url text,
  created_at      timestamptz DEFAULT now()
);
ALTER TABLE backup_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "backup_logs: 본인만" ON backup_logs;
CREATE POLICY "backup_logs: 본인만" ON backup_logs
  FOR ALL USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_backup_logs_user_created
  ON backup_logs(user_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────
-- recurring_plan_completions — RRULE 인스턴스 완료/스킵 추적
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS recurring_plan_completions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  original_plan_id  uuid REFERENCES plans(id) ON DELETE CASCADE,
  plan_date         date NOT NULL,
  is_completed      boolean DEFAULT true,
  created_at        timestamptz DEFAULT now(),
  UNIQUE (original_plan_id, plan_date)
);
ALTER TABLE recurring_plan_completions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "recurring_plan_completions: 본인만" ON recurring_plan_completions;
CREATE POLICY "recurring_plan_completions: 본인만" ON recurring_plan_completions
  FOR ALL USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_recur_completions_user_date
  ON recurring_plan_completions(user_id, plan_date);

-- ─────────────────────────────────────────────────────────────────────────
-- 검증
-- ─────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  cascade_count int;
  rls_count int;
BEGIN
  -- CASCADE 확인 (backup_logs.user_id, recurring_plan_completions.user_id)
  SELECT COUNT(*) INTO cascade_count
  FROM information_schema.referential_constraints rc
  JOIN information_schema.table_constraints tc
    ON rc.constraint_name = tc.constraint_name
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
  WHERE kcu.column_name = 'user_id'
    AND tc.table_schema = 'public'
    AND tc.table_name IN ('backup_logs', 'recurring_plan_completions')
    AND rc.delete_rule = 'CASCADE';

  -- RLS 활성화 확인
  SELECT COUNT(*) INTO rls_count
  FROM pg_tables
  JOIN pg_class ON pg_class.relname = pg_tables.tablename
  WHERE pg_tables.schemaname = 'public'
    AND pg_tables.tablename IN ('backup_logs', 'recurring_plan_completions')
    AND pg_class.relrowsecurity = true;

  IF cascade_count < 2 THEN
    RAISE EXCEPTION '0009 검증 실패: user_id CASCADE 적용된 테이블이 %/2', cascade_count;
  END IF;
  IF rls_count < 2 THEN
    RAISE EXCEPTION '0009 검증 실패: RLS 활성화된 테이블이 %/2', rls_count;
  END IF;

  RAISE NOTICE '0009 적용 완료 — backup_logs, recurring_plan_completions baseline 합류';
END $$;
