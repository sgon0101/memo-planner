-- 0019_safe_hardening — 동작 불변 보안·성능 정리 (2026-09-25, 운영 DB 적용 완료)
-- 적용 전후 사용자 시점 조회 결과(테이블 20개 행 수, search_memos, increment_api_usage)가 동일함을 확인.
-- idempotent: 재실행해도 결과 동일.

-- 1) 중복 정책 삭제 (동일 조건 쌍 중 하나)
drop policy if exists "ai_chats: 본인만 접근" on public.ai_chats;
drop policy if exists "backup_logs: 본인만 접근" on public.backup_logs;
drop policy if exists "folders: 본인만 접근" on public.folders;
drop policy if exists "memo_versions: 본인만 접근" on public.memo_versions;
drop policy if exists "memos: 본인만 접근" on public.memos;
drop policy if exists "plan_templates: 본인만 접근" on public.plan_templates;
drop policy if exists "plans: 본인만 접근" on public.plans;
drop policy if exists "completions: 본인만 접근" on public.recurring_plan_completions;
drop policy if exists "retro_reports: 본인만 접근" on public.retro_reports;
drop policy if exists "user_integrations: 본인만" on public.user_integrations;

-- 2) auth.uid() → (select auth.uid()) : 의미 동일, 행마다 재평가하지 않음
alter policy "ai_chats: 본인만" on public.ai_chats using ((select auth.uid()) = user_id);
alter policy "backup_logs: 본인만" on public.backup_logs using ((select auth.uid()) = user_id);
alter policy "chat_messages: 본인만" on public.chat_messages using ((select auth.uid()) = user_id);
alter policy "chat_rooms: 본인만" on public.chat_rooms using ((select auth.uid()) = user_id);
alter policy "folders: 본인만" on public.folders using ((select auth.uid()) = user_id);
alter policy "memo_sources: 본인만" on public.memo_sources using ((select auth.uid()) = user_id);
alter policy "memo_versions: 본인 메모만" on public.memo_versions
  using (exists (select 1 from public.memos m where m.id = memo_versions.memo_id and m.user_id = (select auth.uid())));
alter policy "memos: 본인만" on public.memos using ((select auth.uid()) = user_id);
alter policy "notif_sent: 본인만" on public.plan_notifications_sent using ((select auth.uid()) = user_id);
alter policy "plan_templates: 본인만" on public.plan_templates using ((select auth.uid()) = user_id);
alter policy "plans: 본인만" on public.plans using ((select auth.uid()) = user_id);
alter policy "profile_history: 본인만" on public.profile_history using ((select auth.uid()) = user_id);
alter policy "push_subs: 본인만" on public.push_subscriptions using ((select auth.uid()) = user_id);
alter policy "recurring_plan_completions: 본인만" on public.recurring_plan_completions using ((select auth.uid()) = user_id);
alter policy "retro_reports: 본인만" on public.retro_reports using ((select auth.uid()) = user_id);
alter policy "source_analyses: 본인만" on public.source_analyses using ((select auth.uid()) = user_id);
alter policy "files: 본인만 접근" on public.uploaded_files using ((select auth.uid()) = user_id);
alter policy "user_integrations: 본인만 접근" on public.user_integrations
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
alter policy "user_profiles: 본인만" on public.user_profiles using ((select auth.uid()) = user_id);

-- 3) SECURITY DEFINER 함수 권한 정리 (authenticated는 rateLimit.ts가 호출하므로 유지)
revoke execute on function public.increment_api_usage(text, integer) from public, anon;
grant execute on function public.increment_api_usage(text, integer) to authenticated, service_role;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

-- 4) search_path 고정 (vector·pg_trgm 모두 public)
alter function public.match_memos(vector, double precision, integer, uuid, uuid) set search_path = public;
alter function public.search_memos(text, uuid, uuid, boolean, integer) set search_path = public;
alter function public.memos_search_vec_update() set search_path = public;
alter function public.memos_content_hash_update() set search_path = public;
alter function public.touch_updated_at() set search_path = public;

-- 5) 중복 인덱스 (idx_folders_user와 정의 동일)
drop index if exists public.idx_folders_user_order;

-- ROLLBACK ------------------------------------------------------------
-- create policy "ai_chats: 본인만 접근" on public.ai_chats using (auth.uid() = user_id);
-- create policy "backup_logs: 본인만 접근" on public.backup_logs using (auth.uid() = user_id);
-- create policy "folders: 본인만 접근" on public.folders using (auth.uid() = user_id);
-- create policy "memo_versions: 본인만 접근" on public.memo_versions using (auth.uid() = (select memos.user_id from memos where memos.id = memo_versions.memo_id));
-- create policy "memos: 본인만 접근" on public.memos using (auth.uid() = user_id);
-- create policy "plan_templates: 본인만 접근" on public.plan_templates using (auth.uid() = user_id);
-- create policy "plans: 본인만 접근" on public.plans using (auth.uid() = user_id);
-- create policy "completions: 본인만 접근" on public.recurring_plan_completions using (auth.uid() = user_id);
-- create policy "retro_reports: 본인만 접근" on public.retro_reports using (auth.uid() = user_id);
-- create policy "user_integrations: 본인만" on public.user_integrations using (auth.uid() = user_id);
-- grant execute on function public.increment_api_usage(text, integer) to public, anon;
-- grant execute on function public.rls_auto_enable() to public, anon, authenticated;
-- alter function public.match_memos(vector, double precision, integer, uuid, uuid) reset search_path;
-- alter function public.search_memos(text, uuid, uuid, boolean, integer) reset search_path;
-- alter function public.memos_search_vec_update() reset search_path;
-- alter function public.memos_content_hash_update() reset search_path;
-- alter function public.touch_updated_at() reset search_path;
-- create index idx_folders_user_order on public.folders using btree (user_id, order_index);
