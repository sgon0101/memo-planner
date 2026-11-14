-- 0025_graph_similarity_links.sql
--
-- 그래프 유사도 링크를 임베딩 기반 "상호 최근접(mutual kNN)"으로 계산하는 RPC.
--
-- 배경 (2026-11-14 실측, 메모 600개):
--   기존 /api/graph/analyze는 메모별 빈출 단어 상위 10개 중 2개 이상 겹치면 연결했는데,
--   상위 단어가 '있는·내가·그리고·너무' 같은 일상어라 링크 1,274개 중 1,081개(85%)가
--   주제와 무관한 연결이었다 → 모든 메모가 서로를 끌어당겨 그래프 중앙에 뭉침.
--
-- 규칙: A↔B 링크 = B가 A의 가장 비슷한 메모 상위 k개 안에 있고, A도 B의 상위 k개 안에
--   있으며(상호), 코사인 유사도가 p_min_sim 이상. 상호 조건 덕분에 메모당 링크가 최대 k개로
--   제한되어 "모든 메모의 이웃이 되는" 허브 노드(실측 최대 28~40개)가 생기지 않는다.
--   k=5, 0.5 기준 실측: 링크 420개, 연결된 메모 361개, 메모당 최대 5개.
--
-- 보안: SECURITY INVOKER(기본) + user_id = auth.uid() — RLS와 같은 범위, 남의 메모는 보지 않는다.
--   잠금 메모·삭제 메모·임베딩 없는 메모는 제외(그래프 분석 규칙과 동일).
--
-- 비용: 메모 수의 제곱에 비례(600개 ≈ 0.8초). 클라이언트가 결과를 5분 캐시하므로 현재 규모에선
--   충분하지만, 메모 수천 개 규모가 되면 임베딩 저장 시 이웃을 미리 계산해 두는 방식으로 바꾼다.

CREATE OR REPLACE FUNCTION public.graph_similarity_links(
  p_k int DEFAULT 5,
  p_min_sim float DEFAULT 0.5
)
RETURNS TABLE (source uuid, target uuid, similarity float)
LANGUAGE sql
STABLE
SET search_path = public, extensions
AS $$
  -- MATERIALIZED + ::real[] 왕복: 임베딩(6KB)은 TOAST로 압축 저장돼, 그대로 쓰면 쌍마다
  -- 압축 해제가 반복된다(실측 6.4초). 한 번만 풀어 메모리에 두면 0.76초.
  WITH base AS MATERIALIZED (
    SELECT m.id, (m.embedding::real[])::vector(1536) AS embedding
    FROM memos m
    WHERE m.user_id = auth.uid()
      AND m.is_deleted = false
      AND m.is_locked = false
      AND m.embedding IS NOT NULL
  ),
  nn AS (
    SELECT a.id AS s, n.id AS d, n.sim
    FROM base a
    CROSS JOIN LATERAL (
      SELECT b.id, 1 - (b.embedding <=> a.embedding) AS sim
      FROM base b
      WHERE b.id <> a.id
      ORDER BY b.embedding <=> a.embedding
      LIMIT GREATEST(LEAST(p_k, 20), 1)
    ) n
  )
  SELECT x.s AS source, x.d AS target, x.sim::float AS similarity
  FROM nn x
  JOIN nn y ON y.s = x.d AND y.d = x.s
  WHERE x.s < x.d
    AND x.sim >= p_min_sim;
$$;

REVOKE ALL ON FUNCTION public.graph_similarity_links(int, float) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.graph_similarity_links(int, float) TO authenticated;
