-- ─────────────────────────────────────────────────────────────────────────
-- 0010_pg_trgm_search.sql
-- ─────────────────────────────────────────────────────────────────────────
-- 한국어 검색 강화 + 태그/위키 인덱스
--
-- 문제:
--   기존 to_tsvector('simple', ...)는 띄어쓰기 토큰화만 함 → 한국어가
--   "회의록" 같은 합성어를 별도 토큰으로 인식 못 함. "회의"로 검색해도
--   "회의록"이 안 잡힘.
--
-- 해결:
--   pg_trgm — trigram 기반 부분 일치 매칭.
--   "회의록"을 trigram으로 분해하면 [회의, 의록] 등 → "회의" 부분 일치 OK.
--   /api/memos/search가 FTS 결과 부족 시 trigram fallback 시도.
--
-- 추가:
--   tags, wiki_links 배열에도 GIN 인덱스 (그래프뷰/태그 필터 가속).
-- ─────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- title/content_text trigram 인덱스
CREATE INDEX IF NOT EXISTS memos_title_trgm_idx
  ON memos USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS memos_content_trgm_idx
  ON memos USING gin (content_text gin_trgm_ops)
  WHERE is_deleted = false;

-- tags / wiki_links GIN 인덱스
CREATE INDEX IF NOT EXISTS memos_tags_gin_idx
  ON memos USING gin (tags);
CREATE INDEX IF NOT EXISTS memos_wiki_links_gin_idx
  ON memos USING gin (wiki_links);

-- 검증
DO $$
DECLARE
  trgm_ok bool;
  idx_count int;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') INTO trgm_ok;
  SELECT COUNT(*) INTO idx_count
  FROM pg_indexes
  WHERE schemaname = 'public'
    AND tablename = 'memos'
    AND indexname IN (
      'memos_title_trgm_idx', 'memos_content_trgm_idx',
      'memos_tags_gin_idx', 'memos_wiki_links_gin_idx'
    );
  IF NOT trgm_ok THEN
    RAISE EXCEPTION '0010 검증 실패: pg_trgm 확장 없음';
  END IF;
  IF idx_count < 4 THEN
    RAISE EXCEPTION '0010 검증 실패: 인덱스 % / 4', idx_count;
  END IF;
  RAISE NOTICE '0010 적용 완료 — pg_trgm + GIN 인덱스 4개';
END $$;
