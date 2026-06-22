-- ─────────────────────────────────────────────────────────────────────────
-- 0013_search_memos_fix.sql
-- ─────────────────────────────────────────────────────────────────────────
-- 0012 search_memos RPC의 한국어 부분일치 버그 픽스.
--
-- 문제:
--   기존 trigram 분기가 `m.title % q OR m.content_text % q` 사용 →
--   `%` 연산자는 전체 문자열 similarity 비교라 짧은 쿼리("회의" 2자)는
--   기본 임계값(0.3) 미달로 매칭 실패. 즉 "회의" → "회의록" 매칭 불가.
--
-- 수정:
--   trigram 분기를 `ILIKE '%' || q || '%'`로 교체.
--   ILIKE도 GIN trgm 인덱스가 가속 → 빠르면서 짧은 쿼리에도 작동.
--   점수는 similarity()로 계산 (제목 매칭 가중치 ↑).
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION search_memos(
  q text,
  user_id_filter uuid,
  folder_filter uuid DEFAULT NULL,
  trash_filter boolean DEFAULT false,
  max_results int DEFAULT 100
)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  title text,
  content_preview text,
  folder_id uuid,
  is_pinned boolean,
  is_starred boolean,
  is_locked boolean,
  is_deleted boolean,
  deleted_at timestamptz,
  tags text[],
  wiki_links text[],
  linked_plan_ids uuid[],
  thumbnail_url text,
  created_at timestamptz,
  updated_at timestamptz,
  score float,
  match_type text
)
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  query_ts tsquery;
  like_pattern text;
BEGIN
  query_ts := websearch_to_tsquery('simple', q);
  -- ILIKE 패턴 — 특수문자 이스케이프 후 %로 감싸기
  like_pattern := '%' || replace(replace(replace(q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  RETURN QUERY
  WITH fts_hits AS (
    SELECT
      m.id, m.user_id, m.title, m.content_preview, m.folder_id,
      m.is_pinned, m.is_starred, m.is_locked, m.is_deleted, m.deleted_at,
      m.tags, m.wiki_links, m.linked_plan_ids, m.thumbnail_url,
      m.created_at, m.updated_at,
      -- FTS는 정확 단어 매칭 — score에 +1 부스트해 trigram보다 위로
      (ts_rank(m.search_vec, query_ts) + 1.0)::float AS score,
      'fts'::text AS match_type
    FROM memos m
    WHERE m.user_id = user_id_filter
      AND m.is_deleted = trash_filter
      AND (folder_filter IS NULL OR m.folder_id = folder_filter)
      AND m.search_vec @@ query_ts
  ),
  ilike_hits AS (
    SELECT
      m.id, m.user_id, m.title, m.content_preview, m.folder_id,
      m.is_pinned, m.is_starred, m.is_locked, m.is_deleted, m.deleted_at,
      m.tags, m.wiki_links, m.linked_plan_ids, m.thumbnail_url,
      m.created_at, m.updated_at,
      -- 점수: 제목 매칭 0.8 + 본문 매칭 0.5 + similarity 보조
      (
        CASE WHEN m.title ILIKE like_pattern THEN 0.8 ELSE 0 END
        + CASE WHEN m.content_text ILIKE like_pattern THEN 0.5 ELSE 0 END
        + GREATEST(
            similarity(coalesce(m.title, ''), q),
            similarity(coalesce(m.content_text, ''), q) * 0.7
          ) * 0.2
      )::float AS score,
      'trigram'::text AS match_type
    FROM memos m
    WHERE m.user_id = user_id_filter
      AND m.is_deleted = trash_filter
      AND (folder_filter IS NULL OR m.folder_id = folder_filter)
      AND (
        m.title ILIKE like_pattern
        OR m.content_text ILIKE like_pattern
      )
      AND NOT EXISTS (SELECT 1 FROM fts_hits f WHERE f.id = m.id)
  ),
  combined AS (
    SELECT * FROM fts_hits
    UNION ALL
    SELECT * FROM ilike_hits
  )
  SELECT
    c.id, c.user_id, c.title, c.content_preview, c.folder_id,
    c.is_pinned, c.is_starred, c.is_locked, c.is_deleted, c.deleted_at,
    c.tags, c.wiki_links, c.linked_plan_ids, c.thumbnail_url,
    c.created_at, c.updated_at,
    c.score, c.match_type
  FROM combined c
  ORDER BY
    c.score DESC,
    c.updated_at DESC
  LIMIT max_results;
END;
$$;

-- 검증
DO $$
DECLARE r record; cnt int;
BEGIN
  -- 함수 정의 확인
  PERFORM 1 FROM pg_proc WHERE proname = 'search_memos';
  IF NOT FOUND THEN
    RAISE EXCEPTION '0013 검증 실패: search_memos 함수 없음';
  END IF;

  -- 한국어 부분일치 sanity check — 본인 메모로 '회의' 검색
  -- (운영 user에서만 동작; 메모가 없으면 0 row 정상)
  SELECT COUNT(*) INTO cnt
  FROM search_memos('회의', auth.uid()::uuid, NULL, false, 100);
  RAISE NOTICE '0013 적용 완료 — search_memos 부분일치 픽스 (auth.uid()의 ''회의'' 매칭: % 건)', cnt;
END $$;
