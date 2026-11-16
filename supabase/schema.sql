-- =====================================================================
-- 🤝 共享模板 Shared templates：数据库结构 + 安全规则
-- 在 Supabase 的 SQL Editor 里，整段贴上，按 Run 执行一次就好
--
-- 比喻：shared_templates = 意见箱
--   一般玩家（publishable key）：只能“投进去”（新增 pending），只能看“已公开的”（approved）
--   你（登入的管理员）：可以看全部、可以审核（改 status）、可以删除
-- =====================================================================

-- ① 数据表：每一行 = 玩家上传的一笔
create table if not exists public.shared_templates (
  id uuid primary key default gen_random_uuid(),
  shape text not null check (shape in (
    'triangle', 'circle', 'lightning', 'star', 'spiral',
    'wave', 'mshape', 'infinity', 'loop'
  )),                                      -- 玩家说自己画的是哪个形状
  points jsonb not null check (
    jsonb_typeof(points) = 'array'
    and jsonb_array_length(points) between 10 and 1000
  ),                                       -- 轨迹座标 [{x, y}, ...]（太少或太多都不收）
  player_id uuid not null,                 -- 匿名玩家编号（存在玩家浏览器里的随机码）
  recognized_as text,                      -- 当下识别器认为是什么
  score real check (score between 0 and 1),-- 当下识别器给的相似度
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);

create index if not exists shared_templates_status_idx on public.shared_templates (status);
create index if not exists shared_templates_player_idx on public.shared_templates (player_id, shape);

-- ② 管理员名单：只有在这张表里的账号才能审核
create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);

-- ③ 打开 RLS（Row Level Security）：没有写成规则的事，一律不准做
alter table public.shared_templates enable row level security;
alter table public.admins enable row level security; -- admins 不写任何规则 → 谁都不能从网页读或改

-- ④ 判断“现在登入的人是不是管理员”
--    security definer = 用建立者的权限去查 admins 表（一般人自己查不到这张表）
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- ⑤ 安全规则
drop policy if exists "anyone can submit pending" on public.shared_templates;
create policy "anyone can submit pending"
  on public.shared_templates for insert
  to anon, authenticated
  with check (status = 'pending');           -- 玩家只能投“待审核”的，不能自己把自己设成通过

drop policy if exists "read approved, admin reads all" on public.shared_templates;
create policy "read approved, admin reads all"
  on public.shared_templates for select
  to anon, authenticated
  using (status = 'approved' or public.is_admin());

drop policy if exists "admin can review" on public.shared_templates;
create policy "admin can review"
  on public.shared_templates for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "admin can delete" on public.shared_templates;
create policy "admin can delete"
  on public.shared_templates for delete
  to authenticated
  using (public.is_admin());

-- ⑥ 每个玩家、每个形状最多 5 个（被拒绝的不算）
--    在数据库这一层再挡一次：就算有人绕过网页直接呼叫 API，也超不过 5 个
create or replace function public.check_contribution_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (
    select count(*) from public.shared_templates
    where player_id = new.player_id
      and shape = new.shape
      and status <> 'rejected'
  ) >= 5 then
    raise exception 'LIMIT_REACHED: max 5 per shape per player';
  end if;
  return new;
end;
$$;

drop trigger if exists contribution_limit on public.shared_templates;
create trigger contribution_limit
  before insert on public.shared_templates
  for each row execute function public.check_contribution_limit();

-- ⑦ 让玩家查询“我每个形状已经交了几个”
--    玩家看不到自己 pending 的那几行（规则 ⑤），所以另外开一个只回传“数量”的小窗口
create or replace function public.get_contribution_counts(p_player uuid)
returns table (shape text, count bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select t.shape, count(*)
  from public.shared_templates t
  where t.player_id = p_player and t.status <> 'rejected'
  group by t.shape;
$$;

-- ⑧ 权限：明确写出哪个角色能用哪个功能
grant select, insert on public.shared_templates to anon, authenticated;
grant update, delete on public.shared_templates to authenticated;
revoke all on public.admins from anon, authenticated;
grant execute on function public.get_contribution_counts(uuid) to anon, authenticated;
grant execute on function public.is_admin() to anon, authenticated;
revoke execute on function public.check_contribution_limit() from anon, authenticated, public;
