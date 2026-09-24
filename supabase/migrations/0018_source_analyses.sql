-- ─────────────────────────────────────────────────────────────────────────
-- 0018_source_analyses.sql
-- ─────────────────────────────────────────────────────────────────────────
-- PDF 노트 3단계: 소스 세트 분석 캐시
--
-- 소스 세트 = PDF 1개 또는 이미지 1~20장(순서 보존). 같은 세트를 다시 분석하지
-- 않도록 결과를 저장한다 — 캐시 히트는 AI 호출·한도 차감이 없다.
--
-- - source_key : sha256(kind + ':' + 순서대로 이어붙인 content_hash들)
--                이미지 순서가 바뀌면 다른 세트(요약 흐름이 달라지므로)
-- - analysis   : 요약 결과 + 유사 메모 + (분할 처리 시) 청크 추출문 + 처리 메타
-- - usage      : 호출별 input/output/cache 토큰 (비용 추적) + 크롭 결과(디버깅)
-- user_id FK는 0007 계정 삭제 cascade 정책과 동일하게 ON DELETE CASCADE.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS source_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  source_key text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('pdf', 'images')),
  file_ids uuid[] NOT NULL,          -- 순서 보존
  analysis jsonb NOT NULL,
  usage jsonb,
  created_at timestamptz DEFAULT now(),
  UNIQUE (user_id, source_key)
);

ALTER TABLE source_analyses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "source_analyses: 본인만" ON source_analyses;
CREATE POLICY "source_analyses: 본인만" ON source_analyses FOR ALL USING (auth.uid() = user_id);

-- 검증
DO $$
DECLARE
  has_table bool;
  has_policy bool;
  has_unique bool;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'source_analyses'
  ) INTO has_table;

  SELECT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'source_analyses'
  ) INTO has_policy;

  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.source_analyses'::regclass AND contype = 'u'
  ) INTO has_unique;

  IF NOT (has_table AND has_policy AND has_unique) THEN
    RAISE EXCEPTION '0018 검증 실패: table=%, policy=%, unique=%', has_table, has_policy, has_unique;
  END IF;
  RAISE NOTICE '0018 적용 완료 — source_analyses 테이블(RLS + UNIQUE(user_id, source_key))';
END $$;

-- ─────────────────────────────────────────────────────────────────────────
-- ROLLBACK
-- ─────────────────────────────────────────────────────────────────────────
-- DROP TABLE IF EXISTS source_analyses;
