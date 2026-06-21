-- ─────────────────────────────────────────────────────────────────────────
-- 0003_embeddings_pgvector.sql
-- ─────────────────────────────────────────────────────────────────────────
-- Phase 1: 메모 임베딩 인프라 — pgvector + HNSW + match_memos RPC.
-- 원본: supabase/_legacy/phase1-embeddings.sql (2026 적용됨)
-- ─────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS vector;

-- embedding 컬럼 — OpenAI text-embedding-3-small (1536 dims)
ALTER TABLE memos
  ADD COLUMN IF NOT EXISTS embedding vector(1536),
  ADD COLUMN IF NOT EXISTS embedding_updated_at timestamptz;

-- HNSW 인덱스 (cosine)
CREATE INDEX IF NOT EXISTS memos_embedding_hnsw_idx
  ON memos USING hnsw (embedding vector_cosine_ops);

-- 의미 검색 RPC
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
