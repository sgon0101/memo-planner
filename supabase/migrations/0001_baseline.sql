-- ─────────────────────────────────────────────────────────────────────────
-- 0001_baseline.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Weave 운영 DB의 baseline 스키마.
-- 모든 명령이 idempotent(IF NOT EXISTS / OR REPLACE)라 운영 DB에 안전 재실행 가능.
-- 신규 환경 셋업 시 이 파일부터 순서대로 0002~0007까지 적용.
--
-- 포함 대상:
--   folders, memos, memo_versions, plans, plan_templates, ai_chats,
--   retro_reports, user_integrations, uploaded_files,
--   push_subscriptions, plan_notifications_sent
--
-- 미포함 (별도 파일):
--   0002 chat_rooms / chat_messages / user_profiles / profile_history
--   0003 pgvector embedding + match_memos RPC
--   0004 plan_templates 확장 컬럼
--   0005 plan_notifications_sent.snoozed_until
--   0006 updated_at 자동 트리거
--   0007 user 종속 FK ON DELETE CASCADE
-- ─────────────────────────────────────────────────────────────────────────

-- 0. 기본 확장
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()

-- ─────────────────────────────────────────────────────────────────────────
-- folders
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users NOT NULL,
  name text NOT NULL,
  color_h integer DEFAULT 260,
  color_s integer DEFAULT 60,
  color_l integer DEFAULT 80,
  parent_id uuid REFERENCES folders(id),
  order_index integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE folders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "folders: 본인만" ON folders;
CREATE POLICY "folders: 본인만" ON folders FOR ALL USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_folders_user ON folders(user_id, order_index);

-- ─────────────────────────────────────────────────────────────────────────
-- memos
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS memos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users NOT NULL,
  folder_id uuid REFERENCES folders(id),
  title text DEFAULT '',
  content jsonb,
  content_text text,
  content_preview text,            -- LIST_COLS용 경량 미리보기
  is_pinned boolean DEFAULT false,
  is_starred boolean DEFAULT false,
  is_locked boolean DEFAULT false,
  locked_content text,
  is_deleted boolean DEFAULT false,
  deleted_at timestamptz,
  tags text[] DEFAULT '{}',
  wiki_links text[] DEFAULT '{}',
  linked_plan_ids uuid[] DEFAULT '{}',
  thumbnail_url text,
  search_vec tsvector,             -- FTS (0001에 미리 정의, 트리거는 별도)
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE memos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "memos: 본인만" ON memos;
CREATE POLICY "memos: 본인만" ON memos FOR ALL USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_memos_user_updated
  ON memos(user_id, is_deleted, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_memos_folder
  ON memos(folder_id) WHERE is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_memos_search_vec
  ON memos USING gin (search_vec);

-- FTS 자동 갱신 (운영 DB에 이미 있음 — idempotent 보장)
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

DROP TRIGGER IF EXISTS memos_search_vec_trg ON memos;
CREATE TRIGGER memos_search_vec_trg
  BEFORE INSERT OR UPDATE OF title, content_text, tags, wiki_links ON memos
  FOR EACH ROW EXECUTE FUNCTION memos_search_vec_update();

-- ─────────────────────────────────────────────────────────────────────────
-- memo_versions
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS memo_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  memo_id uuid REFERENCES memos(id) ON DELETE CASCADE,
  content jsonb,
  content_text text,
  title text,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE memo_versions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "memo_versions: 본인 메모만" ON memo_versions;
CREATE POLICY "memo_versions: 본인 메모만" ON memo_versions
  FOR ALL USING (
    EXISTS (SELECT 1 FROM memos m WHERE m.id = memo_versions.memo_id AND m.user_id = auth.uid())
  );
CREATE INDEX IF NOT EXISTS idx_memo_versions_memo
  ON memo_versions(memo_id, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────
-- plans
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users NOT NULL,
  title text NOT NULL,
  description text,
  color text DEFAULT '#7F77DD',
  date date,
  start_date date,
  end_date date,
  start_time time,
  end_time time,
  is_all_day boolean DEFAULT true,
  is_completed boolean DEFAULT false,
  repeat_type text,                  -- legacy
  repeat_end_date date,
  rrule_str text,                    -- RFC 5545 RRULE (우선)
  notify_enabled boolean NOT NULL DEFAULT true,
  notify_lead_min int NOT NULL DEFAULT 10,
  dday_target date,
  google_event_id text,
  linked_memo_ids uuid[] DEFAULT '{}',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "plans: 본인만" ON plans;
CREATE POLICY "plans: 본인만" ON plans FOR ALL USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_plans_user_date ON plans(user_id, date);
CREATE INDEX IF NOT EXISTS idx_plans_user_rrule ON plans(user_id) WHERE rrule_str IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- plan_templates (baseline 정의만 — 확장 컬럼은 0004)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS plan_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users NOT NULL,
  title text NOT NULL,
  color text NOT NULL,
  start_time time,
  end_time time,
  is_all_day boolean DEFAULT true,
  linked_memo_ids uuid[] DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);
ALTER TABLE plan_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "plan_templates: 본인만" ON plan_templates;
CREATE POLICY "plan_templates: 본인만" ON plan_templates FOR ALL USING (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────
-- ai_chats (legacy 단일 테이블 — chat_rooms로 대체 중이지만 호환 유지)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_chats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users NOT NULL,
  role text NOT NULL,
  content text NOT NULL,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE ai_chats ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ai_chats: 본인만" ON ai_chats;
CREATE POLICY "ai_chats: 본인만" ON ai_chats FOR ALL USING (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────
-- retro_reports
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS retro_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users NOT NULL,
  period text NOT NULL,
  period_start date NOT NULL,
  report_json jsonb,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE retro_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "retro_reports: 본인만" ON retro_reports;
CREATE POLICY "retro_reports: 본인만" ON retro_reports FOR ALL USING (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────
-- user_integrations (Google Calendar / Google Drive 등)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users NOT NULL,
  provider text NOT NULL,
  access_token text,
  refresh_token text,
  token_expiry timestamptz,
  metadata jsonb DEFAULT '{}'::jsonb,   -- 자동백업 설정 등 부가 정보
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, provider)
);
ALTER TABLE user_integrations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "user_integrations: 본인만" ON user_integrations;
CREATE POLICY "user_integrations: 본인만" ON user_integrations FOR ALL USING (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────────
-- uploaded_files (R2 메타데이터 — 향후 PR-3에서 thumbnail_url/medium_url/content_hash 추가)
-- ─────────────────────────────────────────────────────────────────────────
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
DROP POLICY IF EXISTS "files: 본인만 접근" ON uploaded_files;
CREATE POLICY "files: 본인만 접근" ON uploaded_files FOR ALL USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_uploaded_files_user ON uploaded_files(user_id);

-- ─────────────────────────────────────────────────────────────────────────
-- push_subscriptions (Web Push)
-- ─────────────────────────────────────────────────────────────────────────
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
DROP POLICY IF EXISTS "push_subs: 본인만" ON push_subscriptions;
CREATE POLICY "push_subs: 본인만" ON push_subscriptions FOR ALL USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id);

-- ─────────────────────────────────────────────────────────────────────────
-- plan_notifications_sent (중복 알림 방지)
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS plan_notifications_sent (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users NOT NULL,
  plan_id uuid NOT NULL,
  plan_date date NOT NULL,
  sent_at timestamptz DEFAULT now(),
  UNIQUE(plan_id, plan_date)
);
ALTER TABLE plan_notifications_sent ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notif_sent: 본인만" ON plan_notifications_sent;
CREATE POLICY "notif_sent: 본인만" ON plan_notifications_sent FOR ALL USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_notif_sent_lookup
  ON plan_notifications_sent(user_id, plan_date);

-- ─────────────────────────────────────────────────────────────────────────
-- 검증
-- ─────────────────────────────────────────────────────────────────────────
DO $$
DECLARE missing_count int;
BEGIN
  SELECT COUNT(*) INTO missing_count
  FROM (VALUES
    ('folders'), ('memos'), ('memo_versions'), ('plans'), ('plan_templates'),
    ('ai_chats'), ('retro_reports'), ('user_integrations'),
    ('uploaded_files'), ('push_subscriptions'), ('plan_notifications_sent')
  ) AS expected(name)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = expected.name
  );
  IF missing_count > 0 THEN
    RAISE EXCEPTION '0001_baseline 검증 실패: 누락 테이블 % 개', missing_count;
  END IF;
  RAISE NOTICE '0001_baseline 적용 완료 — 모든 테이블 존재 확인';
END $$;
