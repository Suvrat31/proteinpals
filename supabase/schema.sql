-- ProteinPals database schema for Supabase.
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Safe to re-run: it drops and recreates functions/policies, but NOT tables
-- (tables use "if not exists"), so existing data is kept.

create extension if not exists pgcrypto;

-- ─── Tables ──────────────────────────────────────────────────────────────────

create table if not exists public.groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 60),
  invite_code text not null unique default upper(substr(md5(gen_random_uuid()::text), 1, 6)),
  created_by  uuid references auth.users on delete set null,
  created_at  timestamptz not null default now()
);

create table if not exists public.profiles (
  id           uuid primary key references auth.users on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  daily_goal   int  not null default 120 check (daily_goal between 20 and 500),
  group_id     uuid references public.groups on delete set null,
  invited_by   uuid references public.profiles on delete set null,
  created_at   timestamptz not null default now()
);

create table if not exists public.food_logs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references public.profiles on delete cascade,
  log_date      date not null,
  food          text check (char_length(food) <= 80),
  protein       numeric(6,1) not null check (protein between 0 and 500),
  carbs         numeric(6,1) check (carbs between 0 and 2000),
  fat           numeric(6,1) check (fat between 0 and 1000),
  -- The user's daily goal at the moment this entry was logged. The day's goal
  -- is the highest snapshot that day, so lowering your goal late in the day
  -- can't inflate that day's score.
  goal_snapshot int not null,
  created_at    timestamptz not null default now()
);

create index if not exists food_logs_user_date on public.food_logs (user_id, log_date);
create index if not exists profiles_group on public.profiles (group_id);

-- ─── Helpers & triggers ──────────────────────────────────────────────────────

-- Caller's group, read with definer rights so RLS policies can use it
-- without recursing into the profiles policy.
create or replace function public.my_group_id() returns uuid
language sql stable security definer set search_path = public as $$
  select group_id from profiles where id = auth.uid()
$$;

-- Create a profile automatically for every new auth user.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, display_name, daily_goal)
  values (
    new.id,
    left(coalesce(nullif(trim(new.raw_user_meta_data->>'display_name'), ''), split_part(new.email, '@', 1)), 40),
    least(greatest(coalesce((new.raw_user_meta_data->>'daily_goal')::int, 120), 20), 500)
  );
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Stamp each food log with the owner and their current goal (never trust the client for these).
create or replace function public.stamp_food_log() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.user_id := auth.uid();
  select daily_goal into new.goal_snapshot from profiles where id = new.user_id;
  return new;
end $$;

drop trigger if exists food_logs_stamp on public.food_logs;
create trigger food_logs_stamp
  before insert on public.food_logs
  for each row execute function public.stamp_food_log();

-- ─── Group RPCs (called from the app) ────────────────────────────────────────

create or replace function public.create_group(group_name text) returns public.groups
language plpgsql security definer set search_path = public as $$
declare g groups;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  insert into groups (name, created_by) values (trim(group_name), auth.uid()) returning * into g;
  update profiles set group_id = g.id, invited_by = null where id = auth.uid();
  return g;
end $$;

create or replace function public.join_group(code text, inviter uuid default null) returns public.groups
language plpgsql security definer set search_path = public as $$
declare g groups;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into g from groups where invite_code = upper(trim(code));
  if not found then raise exception 'That invite code doesn''t exist'; end if;
  update profiles
     set group_id = g.id,
         invited_by = case
           when inviter is not null and inviter <> auth.uid()
                and exists (select 1 from profiles p where p.id = inviter and p.group_id = g.id)
           then inviter else g.created_by end
   where id = auth.uid();
  return g;
end $$;

create or replace function public.leave_group() returns void
language sql security definer set search_path = public as $$
  update profiles set group_id = null, invited_by = null where id = auth.uid()
$$;

-- ─── Row Level Security ──────────────────────────────────────────────────────

alter table public.groups    enable row level security;
alter table public.profiles  enable row level security;
alter table public.food_logs enable row level security;

drop policy if exists "see my group" on public.groups;
create policy "see my group" on public.groups
  for select to authenticated using (id = public.my_group_id());

drop policy if exists "see me and my group" on public.profiles;
create policy "see me and my group" on public.profiles
  for select to authenticated using (id = auth.uid() or group_id = public.my_group_id());

drop policy if exists "edit my profile" on public.profiles;
create policy "edit my profile" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "see my group's logs" on public.food_logs;
create policy "see my group's logs" on public.food_logs
  for select to authenticated using (
    user_id = auth.uid()
    or user_id in (select id from public.profiles where group_id = public.my_group_id())
  );

drop policy if exists "add my logs" on public.food_logs;
create policy "add my logs" on public.food_logs
  for insert to authenticated with check (user_id = auth.uid());

drop policy if exists "delete my logs" on public.food_logs;
create policy "delete my logs" on public.food_logs
  for delete to authenticated using (user_id = auth.uid());

-- ─── Grants ──────────────────────────────────────────────────────────────────
-- Users may only edit their name and goal directly; group membership changes
-- go through the RPCs above.

revoke all on public.groups, public.profiles, public.food_logs from anon, authenticated;
grant select on public.groups to authenticated;
grant select on public.profiles to authenticated;
grant update (display_name, daily_goal) on public.profiles to authenticated;
grant select, insert, delete on public.food_logs to authenticated;

revoke execute on function public.create_group(text), public.join_group(text, uuid), public.leave_group() from public, anon;
grant execute on function public.create_group(text), public.join_group(text, uuid), public.leave_group(), public.my_group_id() to authenticated;
