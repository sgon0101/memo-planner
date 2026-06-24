-- ─────────────────────────────────────────────────────────────────────────
-- 0015_r2_gc_quota.sql
-- ─────────────────────────────────────────────────────────────────────────
-- PR-3: R2 garbage collection + 사용자별 quota 보조 컬럼
--
-- - uploaded_files.thumbnail_url / medium_url : 변형 추적 (GC 시 함께 삭제)
-- - uploaded_files.content_hash : SHA-256 멱등 (같은 이미지 중복 업로드 방지)
-- - (user_id, content_hash) UNIQUE — 멱등 보장
-- - user_id + created_at 인덱스 — quota 합계 빠른 조회
-- ─────────────────────────────────────────────────────────────────────────

-- 1. 컬럼 추가 (NULL 허용 — 옛 row 호환)
ALTER TABLE uploaded_files
  ADD COLUMN IF NOT EXISTS thumbnail_url text,
  ADD COLUMN IF NOT EXISTS medium_url text,
  ADD COLUMN IF NOT EXISTS content_hash text;

-- 2. content_hash UNIQUE 인덱스 (user 단위 — 다른 사용자 동일 hash 허용)
--    NULL은 인덱스 대상 X (옛 row가 NULL이라도 충돌 안 함)
CREATE UNIQUE INDEX IF NOT EXISTS idx_uploaded_files_user_hash_unique
  ON uploaded_files(user_id, content_hash)
  WHERE content_hash IS NOT NULL;

-- 3. quota 합계 빠른 조회용
CREATE INDEX IF NOT EXISTS idx_uploaded_files_user_size
  ON uploaded_files(user_id) INCLUDE (compressed_size, created_at);

-- 4. 검증
DO $$
DECLARE
  has_thumb bool;
  has_hash bool;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'uploaded_files' AND column_name = 'thumbnail_url'
  ) INTO has_thumb;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'uploaded_files' AND column_name = 'content_hash'
  ) INTO has_hash;

  IF NOT (has_thumb AND has_hash) THEN
    RAISE EXCEPTION '0015 검증 실패: thumbnail_url=%, content_hash=%', has_thumb, has_hash;
  END IF;
  RAISE NOTICE '0015 적용 완료 — uploaded_files에 thumbnail_url, medium_url, content_hash 추가 + UNIQUE 인덱스';
END $$;
