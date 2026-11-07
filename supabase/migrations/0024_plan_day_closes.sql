-- 0024_plan_day_closes — 하루 마감 기록 (2026-11-07)
-- 하루 마감은 일지를 저장하거나(journaled=true) 건너뛸 수 있다(false). 건너뛰기는 일지 메모가 없어
-- 기록이 브라우저에만 남아 스트릭·돌아보기에 잡히지 않았다 → 날짜 단위로 서버에 남긴다.
-- 날짜·일지 작성 여부만 저장(내용 없음). user_id는 0007 정책과 같게 ON DELETE CASCADE.
create table if not exists public.plan_day_closes (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  journaled boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (user_id, day)
);

alter table public.plan_day_closes enable row level security;
drop policy if exists "plan_day_closes: 본인만" on public.plan_day_closes;
create policy "plan_day_closes: 본인만" on public.plan_day_closes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ROLLBACK
-- drop table if exists public.plan_day_closes;
