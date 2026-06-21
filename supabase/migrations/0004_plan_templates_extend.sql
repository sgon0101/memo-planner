-- ─────────────────────────────────────────────────────────────────────────
-- 0004_plan_templates_extend.sql
-- ─────────────────────────────────────────────────────────────────────────
-- 플랜 템플릿 풀-스펙 확장 — 설명·반복·알림·사용 빈도.
-- 원본: supabase/_legacy/plan-templates-extend.sql
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE plan_templates
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS rrule_str text,
  ADD COLUMN IF NOT EXISTS notify_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS notify_lead_min int NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS use_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_used_at timestamptz;

-- 자주 쓰는 템플릿 우선 정렬용 인덱스
CREATE INDEX IF NOT EXISTS idx_plan_templates_use
  ON plan_templates(user_id, use_count DESC, last_used_at DESC NULLS LAST);
