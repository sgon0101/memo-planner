-- Phase 1: 메모 임베딩 인프라
-- Supabase SQL Editor에서 실행

-- ───────────────────────────────────────────
-- 1. pgvector 확장 활성화
-- ───────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS vector;

-- ───────────────────────────────────────────
-- 2. memos 테이블에 embedding 컬럼 추가
--    OpenAI text-embedding-3-small = 1536 dimensions
-- ───────────────────────────────────────────
ALTER TABLE memos
  ADD COLUMN IF NOT EXISTS embedding vector(1536),
  ADD COLUMN IF NOT EXISTS embedding_updated_at timestamptz;

-- ───────────────────────────────────────────
-- 3. HNSW 인덱스 (근사 최근접 이웃 검색, 빠름)
--    cosine 유사도 기준 (방향만 보고 크기 무시)
-- ───────────────────────────────────────────
CREATE INDEX IF NOT EXISTS memos_embedding_hnsw_idx
  ON memos USING hnsw (embedding vector_cosine_ops);

-- ───────────────────────────────────────────
-- 4. 의미 검색용 RPC 함수
--    Vector를 JSON으로 받기 어려워서 함수로 추상화
-- ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION match_memos(
  query_embedding vector(1536),
  match_threshold float DEFAULT 0.5,
  match_count int DEFAULT 5,
  exclude_id uuid DEFAULT NULL,
  user_id_filter uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  title text,
  content_preview text,
  folder_id uuid,
  tags text[],
  similarity float
)
LANGUAGE sql STABLE
AS $$
  SELECT
    m.id,
    m.title,
    m.content_preview,
    m.folder_id,
    m.tags,
    1 - (m.embedding <=> query_embedding) AS similarity
  FROM memos m
  WHERE m.is_deleted = false
    AND m.embedding IS NOT NULL
    AND (exclude_id IS NULL OR m.id != exclude_id)
    AND (user_id_filter IS NULL OR m.user_id = user_id_filter)
    AND 1 - (m.embedding <=> query_embedding) > match_threshold
  ORDER BY m.embedding <=> query_embedding
  LIMIT match_count;
$$;

-- ───────────────────────────────────────────
-- 5. 검증
-- ───────────────────────────────────────────
SELECT
  COUNT(*) AS total_memos,
  COUNT(*) FILTER (WHERE embedding IS NOT NULL) AS embedded,
  COUNT(*) FILTER (WHERE embedding IS NULL) AS not_yet_embedded
FROM memos
WHERE is_deleted = false;
