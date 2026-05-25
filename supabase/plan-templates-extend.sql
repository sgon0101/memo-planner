-- 플랜 템플릿 풀-스펙 확장
-- Supabase SQL Editor에서 실행

ALTER TABLE plan_templates
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS rrule_str text,
  ADD COLUMN IF NOT EXISTS notify_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS notify_lead_min int NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS use_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_used_at timestamptz;

-- 자주 쓰는 템플릿을 위로 정렬할 때 인덱스 도움
CREATE INDEX IF NOT EXISTS idx_plan_templates_use
  ON plan_templates(user_id, use_count DESC, last_used_at DESC NULLS LAST);

-- 검증
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'plan_templates'
ORDER BY ordinal_position;
