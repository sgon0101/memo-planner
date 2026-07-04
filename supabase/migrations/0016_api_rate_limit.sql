-- 0016: AI API rate limiting — 사용자별 일일 호출 한도
-- 목적: /api/ai/* 무제한 호출로 인한 Anthropic API 비용 폭증/DoS 방지
-- 방식: (user_id, bucket, day) 카운터를 원자적으로 증가시키는 SECURITY DEFINER RPC

CREATE TABLE IF NOT EXISTS api_usage (
  user_id uuid NOT NULL,
  bucket text NOT NULL,          -- 'ai-chat', 'ai-insights' 등 엔드포인트 버킷
  day date NOT NULL,
  count integer NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (user_id, bucket, day)
);

-- RLS: 클라이언트 직접 접근 전면 차단 (정책 없음) — 접근은 아래 RPC로만
ALTER TABLE api_usage ENABLE ROW LEVEL SECURITY;

-- 원자적 증가 + 한도 검사. 반환값: 현재 카운트 (한도 초과 시 -1)
-- SECURITY DEFINER: RLS 우회하되 auth.uid()로 호출자 본인 행만 조작
CREATE OR REPLACE FUNCTION increment_api_usage(p_bucket text, p_limit integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_count integer;
BEGIN
  IF v_user IS NULL THEN
    RETURN -1;
  END IF;

  INSERT INTO api_usage (user_id, bucket, day, count)
  VALUES (v_user, p_bucket, CURRENT_DATE, 1)
  ON CONFLICT (user_id, bucket, day)
  DO UPDATE SET count = api_usage.count + 1, updated_at = now()
  RETURNING count INTO v_count;

  IF v_count > p_limit THEN
    RETURN -1;
  END IF;
  RETURN v_count;
END
$$;

-- 오래된 카운터 정리는 불필요 (행 수가 작음). 필요 시 cron에서 day < CURRENT_DATE - 30 삭제.
