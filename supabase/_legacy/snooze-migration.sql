-- 알림 액션 버튼 (#1) — 스누즈 컬럼 추가
-- Supabase SQL Editor에서 실행

ALTER TABLE plan_notifications_sent
  ADD COLUMN IF NOT EXISTS snoozed_until timestamptz;

-- 스누즈 만료된 row를 cron이 빠르게 찾기 위한 부분 인덱스
CREATE INDEX IF NOT EXISTS idx_notif_snoozed
  ON plan_notifications_sent(snoozed_until)
  WHERE snoozed_until IS NOT NULL;

-- 검증
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'plan_notifications_sent'
ORDER BY ordinal_position;
