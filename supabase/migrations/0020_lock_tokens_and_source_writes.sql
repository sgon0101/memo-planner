-- 0020_lock_tokens_and_source_writes — 보안 2단계 DB 마무리 (2026-10-09, 운영 DB 적용 완료)
-- 선행 조건: PR #341/#342(토큰 암호화·서버 전용 접근, source_analyses 쓰기 admin화) 운영 배포 + encrypt-existing-tokens --apply 완료.
-- 검증: 사용자 시점에서 user_integrations 안전 컬럼 조회·metadata 수정·삭제 허용 / 토큰 컬럼 조회·수정·INSERT 거부,
--       source_analyses 조회 허용 / UPDATE 거부, anon 접근 거부. 운영 설정 화면·/api/backup/settings·복원 목록 정상.

-- 1) user_integrations: 브라우저(authenticated)는 토큰 컬럼을 읽거나 쓸 수 없다. 토큰은 서버(service_role)만.
revoke all on public.user_integrations from anon, authenticated;
grant select (id, user_id, provider, token_expiry, created_at, updated_at, metadata) on public.user_integrations to authenticated;
grant update (metadata, updated_at) on public.user_integrations to authenticated;   -- api/backup/settings
grant delete on public.user_integrations to authenticated;                          -- 연결 해제

-- 2) source_analyses: 사용자는 조회만. 쓰기는 서버(service_role)만 → phase 되돌리기로 AI 한도 우회 차단.
revoke all on public.source_analyses from anon, authenticated;
grant select on public.source_analyses to authenticated;

-- 3) 정책도 조회 전용으로 교체 — 권한이 나중에 다시 열려도 쓰기가 막히도록 (SQL Editor에서 적용, 2026-10-09)
drop policy if exists "source_analyses: 본인만" on public.source_analyses;
drop policy if exists "source_analyses: 본인 조회" on public.source_analyses;
create policy "source_analyses: 본인 조회" on public.source_analyses for select to authenticated using ((select auth.uid()) = user_id);

-- ROLLBACK ------------------------------------------------------------
-- grant all on public.user_integrations to anon, authenticated;
-- grant all on public.source_analyses to anon, authenticated;
-- drop policy "source_analyses: 본인 조회" on public.source_analyses;
-- create policy "source_analyses: 본인만" on public.source_analyses using (auth.uid() = user_id);
