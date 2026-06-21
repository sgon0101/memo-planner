-- ─────────────────────────────────────────────────────────────────────────
-- 0007_user_cascade_delete.sql
-- ─────────────────────────────────────────────────────────────────────────
-- 목적:
--   모든 user 종속 테이블의 user_id FK에 ON DELETE CASCADE 설정.
--   auth.users에서 사용자가 삭제되면 모든 종속 row가 자동으로 정리됨.
--
-- 왜 필요한가:
--   - 현재는 ON DELETE 동작 미지정 → 기본 NO ACTION → 사용자 삭제 실패 또는 고아 row.
--   - PIPA / GDPR 데이터 삭제 요구권 충족.
--   - 신규 supabase project에 동일 안전성 자동 보장.
--
-- 또 처리:
--   - folders.parent_id → ON DELETE SET NULL
--     (부모 폴더 삭제 시 자식 폴더는 루트로 승격 — 일반적 UX)
--   - chat_messages.room_id → ON DELETE CASCADE (이미 적용됨, idempotent 보장)
--   - memo_versions.memo_id → ON DELETE CASCADE (이미 적용됨, idempotent 보장)
--
-- 적용 영향:
--   - 데이터는 안 건드림. constraint 정의만 교체.
--   - lock 잠깐 걸리는 ALTER 다수 — 트래픽 적은 시간에 적용 권장.
--
-- 롤백:
--   파일 하단 ROLLBACK 섹션 참고 (constraint 정의를 NO ACTION으로 되돌림).
-- ─────────────────────────────────────────────────────────────────────────

-- 헬퍼 함수 — 기존 FK 제거 후 CASCADE로 재설정
CREATE OR REPLACE FUNCTION _rebind_user_fk(
  p_table text,
  p_column text DEFAULT 'user_id',
  p_on_delete text DEFAULT 'CASCADE'
) RETURNS void AS $$
DECLARE
  constraint_name text;
BEGIN
  -- 테이블 존재 확인
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = p_table
  ) THEN
    RAISE NOTICE '⊘ 테이블 없음, skip: %', p_table;
    RETURN;
  END IF;

  -- 해당 컬럼의 FK constraint 이름 찾기
  SELECT tc.constraint_name INTO constraint_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
   AND tc.table_schema = kcu.table_schema
  WHERE tc.table_schema = 'public'
    AND tc.table_name = p_table
    AND tc.constraint_type = 'FOREIGN KEY'
    AND kcu.column_name = p_column
  LIMIT 1;

  IF constraint_name IS NULL THEN
    RAISE NOTICE '⊘ FK 없음, skip: %.%', p_table, p_column;
    RETURN;
  END IF;

  -- 기존 FK 제거
  EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', p_table, constraint_name);

  -- 새 FK 재설정
  EXECUTE format(
    'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I)
       REFERENCES auth.users(id) ON DELETE %s',
    p_table, constraint_name, p_column, p_on_delete
  );

  RAISE NOTICE '✓ % FK 재설정: % ON DELETE %', p_table, p_column, p_on_delete;
END;
$$ LANGUAGE plpgsql;

-- user_id FK 일괄 재설정 (CASCADE)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'folders',
    'memos',
    'plans',
    'plan_templates',
    'ai_chats',
    'retro_reports',
    'user_integrations',
    'uploaded_files',
    'push_subscriptions',
    'plan_notifications_sent',
    'chat_rooms',
    'chat_messages',
    'user_profiles',
    'profile_history'
  ] LOOP
    PERFORM _rebind_user_fk(t, 'user_id', 'CASCADE');
  END LOOP;
END $$;

-- folders.parent_id → ON DELETE SET NULL (자식 폴더는 루트로 승격)
DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT tc.constraint_name INTO constraint_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
   AND tc.table_schema = kcu.table_schema
  WHERE tc.table_schema = 'public'
    AND tc.table_name = 'folders'
    AND tc.constraint_type = 'FOREIGN KEY'
    AND kcu.column_name = 'parent_id'
  LIMIT 1;

  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE folders DROP CONSTRAINT %I', constraint_name);
    EXECUTE format(
      'ALTER TABLE folders ADD CONSTRAINT %I FOREIGN KEY (parent_id)
         REFERENCES folders(id) ON DELETE SET NULL',
      constraint_name
    );
    RAISE NOTICE '✓ folders.parent_id 재설정: ON DELETE SET NULL';
  END IF;
END $$;

-- 헬퍼 함수 정리
DROP FUNCTION IF EXISTS _rebind_user_fk(text, text, text);

-- 검증
DO $$
DECLARE
  cascade_count int;
  expected_tables text[] := ARRAY[
    'folders','memos','plans','plan_templates','ai_chats','retro_reports',
    'user_integrations','uploaded_files','push_subscriptions',
    'plan_notifications_sent','chat_rooms','chat_messages',
    'user_profiles','profile_history'
  ];
BEGIN
  SELECT COUNT(*) INTO cascade_count
  FROM information_schema.referential_constraints rc
  JOIN information_schema.table_constraints tc
    ON rc.constraint_name = tc.constraint_name
   AND rc.constraint_schema = tc.constraint_schema
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
   AND tc.table_schema = kcu.table_schema
  WHERE rc.delete_rule = 'CASCADE'
    AND tc.table_schema = 'public'
    AND kcu.column_name = 'user_id'
    AND tc.table_name = ANY(expected_tables);

  RAISE NOTICE '0007 적용 완료 — user_id CASCADE 적용 테이블 % / % 개',
    cascade_count, array_length(expected_tables, 1);
END $$;

-- ─────────────────────────────────────────────────────────────────────────
-- ROLLBACK — NO ACTION으로 되돌리기 (필요 시 별도 실행)
-- ─────────────────────────────────────────────────────────────────────────
-- 위의 _rebind_user_fk 함수를 다시 정의 후 p_on_delete := 'NO ACTION'으로
-- 동일 루프 실행하면 원복됨.
