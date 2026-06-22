-- ─────────────────────────────────────────────────────────────────────────
-- 0011_embedding_auto.sql
-- ─────────────────────────────────────────────────────────────────────────
-- 임베딩 자동 무효화 — content_hash 기반.
--
-- 동작:
--   1. content_text가 바뀌면 트리거가 content_hash = md5(content_text) 갱신
--   2. content_hash가 바뀌면 embedding을 NULL로 설정
--   3. backfill cron 또는 클라이언트가 NULL인 메모 재처리
--
-- 왜:
--   - 사용자가 메모 본문 편집 → 임베딩이 stale해짐
--   - 매번 OpenAI 호출은 비용 부담 → backfill 패턴이 효율
--   - content 변경 시점만 hash로 추적 → 의미 없는 trigger(updated_at 등)
--     은 무시
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE memos
  ADD COLUMN IF NOT EXISTS content_hash text;

-- content_text 변경 시 hash 자동 갱신 + embedding 무효화
CREATE OR REPLACE FUNCTION memos_content_hash_update()
RETURNS trigger AS $$
DECLARE
  new_hash text;
BEGIN
  new_hash := md5(coalesce(NEW.content_text, '') || coalesce(NEW.title, ''));

  -- 첫 INSERT 또는 content/title 변경 시
  IF (TG_OP = 'INSERT') OR (NEW.content_hash IS DISTINCT FROM new_hash) THEN
    NEW.content_hash := new_hash;
    -- embedding 무효화 — 다음 backfill에서 재처리
    NEW.embedding := NULL;
    NEW.embedding_updated_at := NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS memos_content_hash_trg ON memos;
CREATE TRIGGER memos_content_hash_trg
  BEFORE INSERT OR UPDATE OF title, content_text ON memos
  FOR EACH ROW EXECUTE FUNCTION memos_content_hash_update();

-- 기존 row에 hash backfill (1회성)
UPDATE memos
SET content_hash = md5(coalesce(content_text, '') || coalesce(title, ''))
WHERE content_hash IS NULL;

-- 검증
DO $$
DECLARE
  with_hash int;
  total int;
BEGIN
  SELECT COUNT(*) FILTER (WHERE content_hash IS NOT NULL), COUNT(*)
  INTO with_hash, total
  FROM memos
  WHERE is_deleted = false;

  RAISE NOTICE '0011 적용 완료 — content_hash 채워진 메모 % / %', with_hash, total;
END $$;
