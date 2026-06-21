-- ─────────────────────────────────────────────────────────────────────────
-- 0005_snooze.sql
-- ─────────────────────────────────────────────────────────────────────────
-- 알림 액션 버튼 — 스누즈 컬럼.
-- 원본: supabase/_legacy/snooze-migration.sql
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE plan_notifications_sent
  ADD COLUMN IF NOT EXISTS snoozed_until timestamptz;

-- 스누즈 만료된 row를 cron이 빠르게 찾기 위한 부분 인덱스
CREATE INDEX IF NOT EXISTS idx_notif_snoozed
  ON plan_notifications_sent(snoozed_until)
  WHERE snoozed_until IS NOT NULL;
