-- 0023_plan_wiki_links — 플랜 위키 칩 (2026-11-07)
-- 플랜의 [[위키]]를 제목 안 표기가 아니라 별도 칸으로 둔다. 제목을 고쳐도 하루 마감·주간 돌아보기의
-- 위키별 집계가 깨지지 않고, 제목은 깨끗하게 유지된다. 즐겨찾기(템플릿)도 같은 칩을 함께 저장한다.
-- 추가만 하는 변경: 기존 행은 빈 배열, 기존 클라이언트(이 칸을 모르는 운영 코드)는 영향 없음.
alter table public.plans          add column if not exists wiki_links text[] not null default '{}';
alter table public.plan_templates add column if not exists wiki_links text[] not null default '{}';

-- ROLLBACK
-- alter table public.plans          drop column if exists wiki_links;
-- alter table public.plan_templates drop column if exists wiki_links;
