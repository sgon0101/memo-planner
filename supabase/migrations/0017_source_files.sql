-- ─────────────────────────────────────────────────────────────────────────
-- 0017_source_files.sql
-- ─────────────────────────────────────────────────────────────────────────
-- PDF 노트 2단계: 소스 파일 인프라
--
-- - uploaded_files.is_source    : 원본 보존 소스 파일 (압축·리사이즈 안 함)
-- - uploaded_files.image_width  : 이미지 원본 가로 (타일 분할 사전 계산용)
-- - uploaded_files.image_height : 이미지 원본 세로
-- - uploaded_files.page_count   : PDF 쪽수
-- - memo_sources                : 노트 ↔ 소스 파일 N:M (이미지 여러 장 → 노트 1개, 순서 보존)
--
-- 기존 uploaded_files.memo_id(1:1)는 호환을 위해 유지하되,
-- 소스 파일의 정식 연결은 memo_sources가 담당한다.
-- user_id FK는 0007 계정 삭제 cascade 정책과 동일하게 ON DELETE CASCADE.
-- ─────────────────────────────────────────────────────────────────────────

-- 1. 소스 파일 메타 컬럼 (NULL 허용 — 옛 row 호환)
ALTER TABLE uploaded_files
  ADD COLUMN IF NOT EXISTS is_source boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS image_width integer,
  ADD COLUMN IF NOT EXISTS image_height integer,
  ADD COLUMN IF NOT EXISTS page_count integer;

-- 2. 노트 ↔ 소스 파일 N:M
CREATE TABLE IF NOT EXISTS memo_sources (
  memo_id    uuid NOT NULL REFERENCES memos(id) ON DELETE CASCADE,
  file_id    uuid NOT NULL REFERENCES uploaded_files(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  position   integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (memo_id, file_id)
);

ALTER TABLE memo_sources ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "memo_sources: 본인만" ON memo_sources;
CREATE POLICY "memo_sources: 본인만" ON memo_sources FOR ALL USING (auth.uid() = user_id);

-- file_id 역방향 조회 (GC에서 "이 파일을 쓰는 노트가 있나")
CREATE INDEX IF NOT EXISTS idx_memo_sources_file ON memo_sources(file_id);
-- 소스 파일만 빠르게 (파일 목록·quota 구분)
CREATE INDEX IF NOT EXISTS idx_uploaded_files_source
  ON uploaded_files(user_id) WHERE is_source = true;

-- 3. 검증
DO $$
DECLARE
  has_is_source bool;
  has_dims bool;
  has_table bool;
  has_policy bool;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'uploaded_files' AND column_name = 'is_source'
  ) INTO has_is_source;

  SELECT count(*) = 3 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'uploaded_files'
      AND column_name IN ('image_width', 'image_height', 'page_count')
  INTO has_dims;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'memo_sources'
  ) INTO has_table;

  SELECT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'memo_sources'
  ) INTO has_policy;

  IF NOT (has_is_source AND has_dims AND has_table AND has_policy) THEN
    RAISE EXCEPTION '0017 검증 실패: is_source=%, dims=%, memo_sources=%, policy=%',
      has_is_source, has_dims, has_table, has_policy;
  END IF;
  RAISE NOTICE '0017 적용 완료 — uploaded_files 소스 메타 4컬럼 + memo_sources 테이블(RLS)';
END $$;

-- ─────────────────────────────────────────────────────────────────────────
-- ROLLBACK
-- ─────────────────────────────────────────────────────────────────────────
-- DROP TABLE IF EXISTS memo_sources;
-- ALTER TABLE uploaded_files
--   DROP COLUMN IF EXISTS is_source,
--   DROP COLUMN IF EXISTS image_width,
--   DROP COLUMN IF EXISTS image_height,
--   DROP COLUMN IF EXISTS page_count;
-- DROP INDEX IF EXISTS idx_uploaded_files_source;
