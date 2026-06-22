-- ─────────────────────────────────────────────────────────────────────────
-- 0014_lock_security.sql
-- ─────────────────────────────────────────────────────────────────────────
-- PR-2: 잠금 메모 보안 강화 보조 컬럼
--
-- - memos.lock_hint: 사용자가 비번 잊었을 때 도움이 될 힌트 (평문 80자, optional)
-- - memo_versions.is_encrypted: 향후 잠금 메모의 ciphertext 버전 저장 시 식별용
--
-- PBKDF2 600k iter 강화는 클라이언트 코드(lock.ts)에서 처리.
-- 잠금 시점에 기존 평문 버전 일괄 삭제는 클라이언트(useMemos.lockMemo)에서.
-- ─────────────────────────────────────────────────────────────────────────

-- 1. memos.lock_hint (옵션, 평문, NULL 가능)
ALTER TABLE memos
  ADD COLUMN IF NOT EXISTS lock_hint text
  CHECK (lock_hint IS NULL OR length(lock_hint) <= 80);

-- 2. memo_versions.is_encrypted (향후 확장용)
ALTER TABLE memo_versions
  ADD COLUMN IF NOT EXISTS is_encrypted boolean NOT NULL DEFAULT false;

-- 3. 잠긴 메모의 옛 평문 버전 일괄 정리 (1회성 — 기존 사용자 보호)
-- 안전을 위해 NOTICE만 출력. 곤이 검토 후 수동으로 DELETE 결정.
DO $$
DECLARE n_versions int;
BEGIN
  SELECT COUNT(*) INTO n_versions
  FROM memo_versions mv
  JOIN memos m ON m.id = mv.memo_id
  WHERE m.is_locked = true
    AND (mv.is_encrypted = false OR mv.is_encrypted IS NULL);

  IF n_versions > 0 THEN
    RAISE NOTICE '⚠ 잠긴 메모의 평문 버전 이력 % 개 발견 — 보안 정리 권장:', n_versions;
    RAISE NOTICE '   DELETE FROM memo_versions';
    RAISE NOTICE '   WHERE memo_id IN (SELECT id FROM memos WHERE is_locked = true)';
    RAISE NOTICE '     AND (is_encrypted = false OR is_encrypted IS NULL);';
  END IF;

  RAISE NOTICE '0014 적용 완료 — lock_hint + is_encrypted 컬럼 추가';
END $$;
