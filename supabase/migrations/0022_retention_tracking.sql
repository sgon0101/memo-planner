-- 0022_retention_tracking — 베타 리텐션·활성화 측정 (2026-10-18)
--
-- 설계:
--   - 1st-party: analytics 스키마(PostgREST 비노출). 내용은 저장하지 않고 횟수·날짜만.
--   - "쓰기"는 AFTER 트리거로 수집(클라이언트 직접 insert·오프라인 큐 flush 경로까지 누락 없음),
--     "열기"는 public.track_open() RPC(클라이언트 하루 1회).
--   - 활성일은 KST 날짜. auth.users CASCADE → 계정 삭제 시 함께 삭제.
--   - 측정 실패가 저장을 막으면 안 된다: bump/mark와 트리거 함수 모두 예외를 삼킨다.
--   - 트리거 함수는 SECURITY DEFINER — authenticated는 analytics 스키마 권한이 없으므로
--     호출자 권한으로 돌면 매번 조용히 실패한다.
-- DROP 없이 재실행 가능하게 작성 (if not exists / create or replace).

create schema if not exists analytics;
revoke all on schema analytics from public, anon, authenticated;
grant usage on schema analytics to service_role;

-- ─── 테이블 ──────────────────────────────────────────────────────────
create table if not exists analytics.user_activity_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,                        -- KST
  opens int not null default 0,
  memos_created int not null default 0,
  memos_edited int not null default 0,      -- 제목·본문 변경 1회당 +1 (자동저장 횟수 — 단순 카운트)
  plans_created int not null default 0,
  source_notes int not null default 0,
  ai_messages int not null default 0,
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  primary key (user_id, day)
);

create table if not exists analytics.user_milestones (
  user_id uuid not null references auth.users(id) on delete cascade,
  milestone text not null,  -- first_memo | first_wiki_link | first_plan | first_source_note | drive_connected
  reached_at timestamptz not null default now(),
  primary key (user_id, milestone)
);

create table if not exists analytics.internal_users (
  user_id uuid primary key,  -- FK 없음: 삭제된 테스트 계정 id가 남아도 무해
  note text
);

insert into analytics.internal_users (user_id, note)
values ('9fcfaa5e-01de-4625-a3d2-1af8b24f0844', '메인 계정(운영자)')
on conflict (user_id) do nothing;

-- ─── 기록 함수 ───────────────────────────────────────────────────────
create or replace function analytics.bump(p_user uuid, p_col text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_user is null or p_col not in
     ('opens', 'memos_created', 'memos_edited', 'plans_created', 'source_notes', 'ai_messages') then
    return;
  end if;
  execute format(
    'insert into analytics.user_activity_daily as a (user_id, day, %1$I) values ($1, $2, 1)
     on conflict (user_id, day) do update set %1$I = a.%1$I + 1, last_at = now()',
    p_col)
  using p_user, (now() at time zone 'Asia/Seoul')::date;
exception when others then
  return;
end $$;

create or replace function analytics.mark(p_user uuid, p_milestone text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_user is null then return; end if;
  insert into analytics.user_milestones (user_id, milestone)
  values (p_user, p_milestone)
  on conflict (user_id, milestone) do nothing;
exception when others then
  return;
end $$;

-- ─── 트리거 함수 ─────────────────────────────────────────────────────
create or replace function analytics.trg_memos_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  begin
    perform analytics.bump(new.user_id, 'memos_created');
    perform analytics.mark(new.user_id, 'first_memo');
    if coalesce(cardinality(new.wiki_links), 0) > 0 then
      perform analytics.mark(new.user_id, 'first_wiki_link');
    end if;
  exception when others then null;
  end;
  return null;
end $$;

-- WHEN 조건으로 제목·본문(content_hash)·wiki_links가 바뀐 경우에만 호출된다
-- (고정·별표·휴지통 이동 등 메타 변경은 '수정'으로 세지 않음).
create or replace function analytics.trg_memos_update()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  begin
    if new.content_hash is distinct from old.content_hash or new.title is distinct from old.title then
      perform analytics.bump(new.user_id, 'memos_edited');
    end if;
    if coalesce(cardinality(new.wiki_links), 0) > 0 then
      perform analytics.mark(new.user_id, 'first_wiki_link');
    end if;
  exception when others then null;
  end;
  return null;
end $$;

create or replace function analytics.trg_plans_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  begin
    perform analytics.bump(new.user_id, 'plans_created');
    perform analytics.mark(new.user_id, 'first_plan');
  exception when others then null;
  end;
  return null;
end $$;

-- 노트 1개에 이미지가 여러 장이면 파일마다 행이 생기므로 position = 0 행만 센다 (WHEN 조건)
create or replace function analytics.trg_memo_sources_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  begin
    perform analytics.bump(new.user_id, 'source_notes');
    perform analytics.mark(new.user_id, 'first_source_note');
  exception when others then null;
  end;
  return null;
end $$;

create or replace function analytics.trg_ai_user_message()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  begin
    perform analytics.bump(new.user_id, 'ai_messages');
  exception when others then null;
  end;
  return null;
end $$;

create or replace function analytics.trg_drive_connected()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  begin
    perform analytics.mark(new.user_id, 'drive_connected');
  exception when others then null;
  end;
  return null;
end $$;

-- ─── 트리거 (AFTER, 기존 BEFORE 트리거 뒤 — 이름 zz_analytics_*) ──────
create or replace trigger zz_analytics_memos_insert
  after insert on public.memos
  for each row execute function analytics.trg_memos_insert();

create or replace trigger zz_analytics_memos_update
  after update on public.memos
  for each row
  when (new.content_hash is distinct from old.content_hash
        or new.title is distinct from old.title
        or new.wiki_links is distinct from old.wiki_links)
  execute function analytics.trg_memos_update();

create or replace trigger zz_analytics_plans_insert
  after insert on public.plans
  for each row execute function analytics.trg_plans_insert();

create or replace trigger zz_analytics_memo_sources_insert
  after insert on public.memo_sources
  for each row when (new.position = 0)
  execute function analytics.trg_memo_sources_insert();

create or replace trigger zz_analytics_chat_messages_insert
  after insert on public.chat_messages
  for each row when (new.role = 'user')
  execute function analytics.trg_ai_user_message();

-- ai_chats는 레거시(현재 코드는 chat_messages만 씀) — 경로가 되살아나도 누락되지 않게 같이 붙인다
create or replace trigger zz_analytics_ai_chats_insert
  after insert on public.ai_chats
  for each row when (new.role = 'user')
  execute function analytics.trg_ai_user_message();

create or replace trigger zz_analytics_user_integrations_insert
  after insert on public.user_integrations
  for each row when (new.provider = 'google_drive')
  execute function analytics.trg_drive_connected();

-- ─── 열기 RPC (클라이언트에 유일하게 노출) ───────────────────────────
create or replace function public.track_open()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return; end if;
  perform analytics.bump(auth.uid(), 'opens');
end $$;

revoke execute on function public.track_open() from public, anon;
grant execute on function public.track_open() to authenticated;

-- ─── 조회 뷰 (service_role / 운영자만) ───────────────────────────────
-- 내부 계정 제외: internal_users + 테스트 계정 이메일 패턴(+weavetest)
create or replace view analytics.v_users as
select
  u.id as user_id,
  u.created_at as signed_up_at,
  (u.created_at at time zone 'Asia/Seoul')::date as signup_day,
  date_trunc('week', (u.created_at at time zone 'Asia/Seoul')::date)::date as cohort_week
from auth.users u
where not exists (select 1 from analytics.internal_users i where i.user_id = u.id)
  and coalesce(u.email, '') not ilike '%+weavetest%';

-- 코호트 주 × W0~W4. eligible = 그 주차 구간이 시작된(=측정 가능한) 사용자 수
create or replace view analytics.v_weekly_retention as
with today as (select (now() at time zone 'Asia/Seoul')::date as d),
weeks as (select generate_series(0, 4) as week_n),
per_user as (
  select
    v.cohort_week, v.user_id, w.week_n,
    (v.signup_day + 7 * w.week_n) <= (select d from today) as eligible,
    exists (
      select 1 from analytics.user_activity_daily a
      where a.user_id = v.user_id
        and a.day between v.signup_day + 7 * w.week_n and v.signup_day + 7 * w.week_n + 6
    ) as active
  from analytics.v_users v cross join weeks w
)
select
  cohort_week,
  week_n,
  count(*) as cohort_size,
  count(*) filter (where eligible) as eligible,
  count(*) filter (where eligible and active) as retained,
  round(100.0 * count(*) filter (where eligible and active)
        / nullif(count(*) filter (where eligible), 0), 1) as retention_pct
from per_user
group by cohort_week, week_n
order by cohort_week, week_n;

-- 아하 모먼트: 가입 후 7일 이내 first_wiki_link 또는 first_source_note
create or replace view analytics.v_activation as
select
  v.user_id,
  v.cohort_week,
  v.signed_up_at,
  w.reached_at as first_wiki_link_at,
  s.reached_at as first_source_note_at,
  m.reached_at as first_memo_at,
  p.reached_at as first_plan_at,
  d.reached_at as drive_connected_at,
  least(w.reached_at, s.reached_at) as aha_at,
  coalesce(least(w.reached_at, s.reached_at) <= v.signed_up_at + interval '7 days', false) as activated_7d,
  round(extract(epoch from least(w.reached_at, s.reached_at) - v.signed_up_at) / 3600.0, 1) as hours_to_aha
from analytics.v_users v
left join analytics.user_milestones w on w.user_id = v.user_id and w.milestone = 'first_wiki_link'
left join analytics.user_milestones s on s.user_id = v.user_id and s.milestone = 'first_source_note'
left join analytics.user_milestones m on m.user_id = v.user_id and m.milestone = 'first_memo'
left join analytics.user_milestones p on p.user_id = v.user_id and p.milestone = 'first_plan'
left join analytics.user_milestones d on d.user_id = v.user_id and d.milestone = 'drive_connected';

-- 일별 DAU + 그 날이 속한 주(월요일 시작)의 WAU
create or replace view analytics.v_daily_active as
with act as (
  select a.user_id, a.day, date_trunc('week', a.day)::date as week_start
  from analytics.user_activity_daily a
  join analytics.v_users v on v.user_id = a.user_id
),
wau as (select week_start, count(distinct user_id) as wau from act group by week_start)
select act.day, count(distinct act.user_id) as dau, act.week_start, wau.wau
from act join wau using (week_start)
group by act.day, act.week_start, wau.wau
order by act.day;

-- 첫 7일 행동 합계 + W4 잔존 — "무엇이 붙잡는가" 비교용
create or replace view analytics.v_first_week_behavior as
select
  v.user_id,
  v.cohort_week,
  v.signup_day,
  coalesce(sum(a.memos_created), 0) as memos_created,
  coalesce(sum(a.memos_edited), 0) as memos_edited,
  coalesce(sum(a.plans_created), 0) as plans_created,
  coalesce(sum(a.source_notes), 0) as source_notes,
  coalesce(sum(a.ai_messages), 0) as ai_messages,
  count(a.day) filter (where a.opens > 0) as open_days,
  count(a.day) as active_days,
  (v.signup_day + 28) <= (now() at time zone 'Asia/Seoul')::date as w4_eligible,
  exists (
    select 1 from analytics.user_activity_daily r
    where r.user_id = v.user_id and r.day between v.signup_day + 28 and v.signup_day + 34
  ) as retained_w4
from analytics.v_users v
left join analytics.user_activity_daily a
  on a.user_id = v.user_id and a.day between v.signup_day and v.signup_day + 6
group by v.user_id, v.cohort_week, v.signup_day;

-- ─── 권한 정리 ───────────────────────────────────────────────────────
-- 함수는 기본적으로 PUBLIC 실행 권한이 붙으므로 analytics 함수 전부 회수
revoke all on all tables in schema analytics from public, anon, authenticated;
revoke all on all functions in schema analytics from public, anon, authenticated;
grant select on all tables in schema analytics to service_role;

-- ROLLBACK (수동)
-- drop trigger zz_analytics_memos_insert on public.memos; drop trigger zz_analytics_memos_update on public.memos;
-- drop trigger zz_analytics_plans_insert on public.plans; drop trigger zz_analytics_memo_sources_insert on public.memo_sources;
-- drop trigger zz_analytics_chat_messages_insert on public.chat_messages; drop trigger zz_analytics_ai_chats_insert on public.ai_chats;
-- drop trigger zz_analytics_user_integrations_insert on public.user_integrations;
-- drop function public.track_open(); drop schema analytics cascade;
