-- 0021_api_usage_user_fk — api_usage도 계정 삭제 시 함께 지워지도록 (2026-10-18, 운영 DB 적용 완료)
-- api_usage만 auth.users FK가 없어 계정 삭제 후 고아 행이 남는 구조였다. 적용 전 고아 행 0건 확인.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'api_usage_user_id_fkey') then
    alter table public.api_usage
      add constraint api_usage_user_id_fkey foreign key (user_id) references auth.users(id) on delete cascade;
  end if;
end $$;

-- ROLLBACK
-- alter table public.api_usage drop constraint api_usage_user_id_fkey;
