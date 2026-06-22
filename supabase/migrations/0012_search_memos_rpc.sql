-- ─────────────────────────────────────────────────────────────────────────
-- 0012_search_memos_rpc.sql
-- ─────────────────────────────────────────────────────────────────────────
-- 검색 RPC — FTS + ts_rank + trigram fallback 단일 함수로.
--
-- 호출:
--   SELECT * FROM search_memos('회의', auth.uid(), null, 50);
--
-- 동작:
--   1. FTS websearch_to_tsquery('simple', q)로 1차 매칭
--   2. ts_rank로 관련도 점수 산출
--   3. FTS hit < 5면 trigram similarity로 보조 결과 추가
--   4. 중복 제거, similarity 점수 내림차순 정렬
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
BEGIN
  -- websearch_to_tsquery는 빈 문자열에서 빈 쿼리 반환 → 안전
  query_ts := websearch_to_tsquery('simple', q);

  RETURN QUERY
  WITH fts_hits AS (
    SELECT
      m.id, m.user_id, m.title, m.content_preview, m.folder_id,
      m.is_pinned, m.is_starred, m.is_locked, m.is_deleted, m.deleted_at,
      m.tags, m.wiki_links, m.linked_plan_ids, m.thumbnail_url,
      m.created_at, m.updated_at,
      ts_rank(m.search_vec, query_ts) AS score,
      'fts'::text AS match_type
    FROM memos m
    WHERE m.user_id = user_id_filter
      AND m.is_deleted = trash_filter
      AND (folder_filter IS NULL OR m.folder_id = folder_filter)
      AND m.search_vec @@ query_ts
  ),
  trgm_hits AS (
    SELECT
      m.id, m.user_id, m.title, m.content_preview, m.folder_id,
      m.is_pinned, m.is_starred, m.is_locked, m.is_deleted, m.deleted_at,
      m.tags, m.wiki_links, m.linked_plan_ids, m.thumbnail_url,
      m.created_at, m.updated_at,
      GREATEST(
        similarity(coalesce(m.title, ''), q),
        similarity(coalesce(m.content_text, ''), q) * 0.7
      ) AS score,
      'trigram'::text AS match_type
    FROM memos m
    WHERE m.user_id = user_id_filter
      AND m.is_deleted = trash_filter
      AND (folder_filter IS NULL OR m.folder_id = folder_filter)
      AND (
        m.title % q
        OR m.content_text % q
      )
      AND NOT EXISTS (SELECT 1 FROM fts_hits f WHERE f.id = m.id)
  ),
  combined AS (
    SELECT * FROM fts_hits
    UNION ALL
    SELECT * FROM trgm_hits
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
DECLARE r record;
BEGIN
  -- 함수 정의 확인 (실제 호출은 user_id가 필요해서 여기선 안 함)
  PERFORM 1 FROM pg_proc WHERE proname = 'search_memos';
  IF NOT FOUND THEN
    RAISE EXCEPTION '0012 검증 실패: search_memos 함수 없음';
  END IF;
  RAISE NOTICE '0012 적용 완료 — search_memos RPC 등록';
END $$;
