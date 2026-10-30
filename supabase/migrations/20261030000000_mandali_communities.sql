create table if not exists public.mandalis (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 80),
  description text not null default '' check (char_length(description) <= 500),
  icon text not null default '✦' check (char_length(icon) between 1 and 12),
  visibility text not null default 'private' check (visibility in ('private', 'discoverable')),
  owner_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.mandali_members (
  mandali_id uuid not null references public.mandalis (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (mandali_id, user_id)
);

create table if not exists public.mandali_messages (
  id uuid primary key default gen_random_uuid(),
  mandali_id uuid not null references public.mandalis (id) on delete cascade,
  sender_id uuid not null references auth.users (id) on delete cascade,
  content text not null check (char_length(btrim(content)) between 1 and 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.mandali_invites (
  id uuid primary key default gen_random_uuid(),
  mandali_id uuid not null references public.mandalis (id) on delete cascade,
  code text not null unique default replace(gen_random_uuid()::text, '-', ''),
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  revoked_at timestamptz
);

create index if not exists mandalis_discoverable_created_idx
  on public.mandalis (created_at desc) where visibility = 'discoverable';
create index if not exists mandali_members_user_joined_idx
  on public.mandali_members (user_id, joined_at desc);
create index if not exists mandali_messages_created_idx
  on public.mandali_messages (mandali_id, created_at desc);

alter table public.mandalis enable row level security;
alter table public.mandali_members enable row level security;
alter table public.mandali_messages enable row level security;
alter table public.mandali_invites enable row level security;

create or replace function public.is_mandali_member(p_mandali_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.mandali_members m
    where m.mandali_id = p_mandali_id and m.user_id = auth.uid()
  );
$$;

create or replace function public.shares_mandali_with(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.mandali_members own
    join public.mandali_members other on other.mandali_id = own.mandali_id
    where own.user_id = auth.uid() and other.user_id = p_user_id
  );
$$;

revoke all on function public.is_mandali_member(uuid) from public;
revoke all on function public.shares_mandali_with(uuid) from public;
grant execute on function public.is_mandali_member(uuid) to authenticated;
grant execute on function public.shares_mandali_with(uuid) to authenticated;

drop policy if exists "Members and discoverable communities are readable" on public.mandalis;
create policy "Members and discoverable communities are readable"
  on public.mandalis for select to authenticated
  using (
    visibility = 'discoverable'
    or (select public.is_mandali_member(id))
  );

drop policy if exists "Members read their community roster" on public.mandali_members;
create policy "Members read their community roster"
  on public.mandali_members for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select public.is_mandali_member(mandali_id))
  );

drop policy if exists "Members read community messages" on public.mandali_messages;
create policy "Members read community messages"
  on public.mandali_messages for select to authenticated
  using ((select public.is_mandali_member(mandali_id)));
drop policy if exists "Members send their own community messages" on public.mandali_messages;
create policy "Members send their own community messages"
  on public.mandali_messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and (select public.is_mandali_member(mandali_id))
  );
drop policy if exists "Authors edit their own community messages" on public.mandali_messages;
create policy "Authors edit their own community messages"
  on public.mandali_messages for update to authenticated
  using (sender_id = (select auth.uid()) and (select public.is_mandali_member(mandali_id)))
  with check (sender_id = (select auth.uid()) and (select public.is_mandali_member(mandali_id)));
drop policy if exists "Authors and community admins delete messages" on public.mandali_messages;
create policy "Authors and community admins delete messages"
  on public.mandali_messages for delete to authenticated
  using (
    sender_id = (select auth.uid())
    or exists (
      select 1 from public.mandali_members m
      where m.mandali_id = mandali_id and m.user_id = (select auth.uid())
        and m.role in ('owner', 'admin')
    )
  );

drop policy if exists "Admins read community invite links" on public.mandali_invites;
create policy "Admins read community invite links"
  on public.mandali_invites for select to authenticated
  using (exists (
    select 1 from public.mandali_members m
    where m.mandali_id = mandali_id
      and m.user_id = (select auth.uid())
      and m.role in ('owner', 'admin')
  ));

drop policy if exists "Community members can read each other's profiles" on public.profiles;
create policy "Community members can read each other's profiles"
  on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or (select public.shares_mandali_with(profiles.id))
  );

revoke all on public.mandalis, public.mandali_members, public.mandali_invites from anon, authenticated;
grant select on public.mandalis, public.mandali_members, public.mandali_invites to authenticated;
revoke all on public.mandali_messages from anon, authenticated;
grant select, insert, update, delete on public.mandali_messages to authenticated;

create or replace function public.create_mandali(
  p_name text,
  p_description text,
  p_icon text,
  p_visibility text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  new_mandali_id uuid;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 2 and 80 then
    raise exception 'Community names must be between 2 and 80 characters';
  end if;
  if char_length(coalesce(p_description, '')) > 500 then
    raise exception 'Community descriptions cannot exceed 500 characters';
  end if;
  if p_visibility not in ('private', 'discoverable') then
    raise exception 'Choose private or discoverable visibility';
  end if;

  insert into public.mandalis (name, description, icon, visibility, owner_id)
  values (btrim(p_name), coalesce(p_description, ''), coalesce(nullif(p_icon, ''), '✦'), p_visibility, current_user_id)
  returning id into new_mandali_id;
  insert into public.mandali_members (mandali_id, user_id, role)
  values (new_mandali_id, current_user_id, 'owner');
  return new_mandali_id;
end;
$$;

create or replace function public.join_mandali(p_mandali_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.mandalis m
    where m.id = p_mandali_id and m.visibility = 'discoverable'
  ) then raise exception 'This community is private or unavailable'; end if;
  insert into public.mandali_members (mandali_id, user_id)
  values (p_mandali_id, auth.uid())
  on conflict (mandali_id, user_id) do nothing;
end;
$$;

create or replace function public.leave_mandali(p_mandali_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if exists (
    select 1 from public.mandali_members
    where mandali_id = p_mandali_id and user_id = auth.uid() and role = 'owner'
  ) then raise exception 'Transfer ownership or delete the community before leaving'; end if;
  delete from public.mandali_members
  where mandali_id = p_mandali_id and user_id = auth.uid();
end;
$$;

create or replace function public.create_mandali_invite(p_mandali_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  invite_code text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.mandali_members
    where mandali_id = p_mandali_id and user_id = auth.uid() and role in ('owner', 'admin')
  ) then raise exception 'Only community admins can create invite links'; end if;
  insert into public.mandali_invites (mandali_id, created_by)
  values (p_mandali_id, auth.uid())
  returning code into invite_code;
  return invite_code;
end;
$$;

create or replace function public.join_mandali_by_invite(p_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  invite_mandali_id uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select i.mandali_id into invite_mandali_id
  from public.mandali_invites i
  where i.code = p_code and i.revoked_at is null and i.expires_at > now();
  if invite_mandali_id is null then raise exception 'This invite link is invalid, expired, or revoked'; end if;
  insert into public.mandali_members (mandali_id, user_id)
  values (invite_mandali_id, auth.uid())
  on conflict (mandali_id, user_id) do nothing;
  return invite_mandali_id;
end;
$$;

create or replace function public.remove_mandali_member(p_mandali_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_role text;
  target_role text;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select role into actor_role from public.mandali_members
  where mandali_id = p_mandali_id and user_id = auth.uid();
  select role into target_role from public.mandali_members
  where mandali_id = p_mandali_id and user_id = p_user_id;
  if actor_role is null or target_role is null then raise exception 'Community member not found'; end if;
  if actor_role not in ('owner', 'admin') or target_role = 'owner' or (actor_role = 'admin' and target_role = 'admin') then
    raise exception 'You do not have permission to remove this member';
  end if;
  delete from public.mandali_members
  where mandali_id = p_mandali_id and user_id = p_user_id;
end;
$$;

create or replace function public.update_mandali(
  p_mandali_id uuid,
  p_name text,
  p_description text,
  p_icon text,
  p_visibility text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.mandali_members
    where mandali_id = p_mandali_id and user_id = auth.uid() and role in ('owner', 'admin')
  ) then raise exception 'Only community admins can update community settings'; end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 2 and 80
    or char_length(coalesce(p_description, '')) > 500
    or p_visibility not in ('private', 'discoverable') then
    raise exception 'Invalid community settings';
  end if;
  update public.mandalis
  set name = btrim(p_name), description = coalesce(p_description, ''),
      icon = coalesce(nullif(p_icon, ''), '✦'), visibility = p_visibility,
      updated_at = now()
  where id = p_mandali_id;
end;
$$;

create or replace function public.transfer_mandali_ownership(p_mandali_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.mandali_members
    where mandali_id = p_mandali_id and user_id = auth.uid() and role = 'owner'
  ) then raise exception 'Only the owner can transfer ownership'; end if;
  if p_user_id = auth.uid() or not exists (
    select 1 from public.mandali_members
    where mandali_id = p_mandali_id and user_id = p_user_id
  ) then raise exception 'Choose another current community member'; end if;
  update public.mandali_members set role = 'admin'
  where mandali_id = p_mandali_id and user_id = auth.uid();
  update public.mandali_members set role = 'owner'
  where mandali_id = p_mandali_id and user_id = p_user_id;
  update public.mandalis set owner_id = p_user_id, updated_at = now()
  where id = p_mandali_id;
end;
$$;

create or replace function public.delete_mandali(p_mandali_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.mandali_members
    where mandali_id = p_mandali_id and user_id = auth.uid() and role = 'owner'
  ) then raise exception 'Only the owner can delete this community'; end if;
  delete from public.mandalis where id = p_mandali_id;
end;
$$;

revoke all on function public.create_mandali(text, text, text, text) from public;
revoke all on function public.join_mandali(uuid) from public;
revoke all on function public.leave_mandali(uuid) from public;
revoke all on function public.create_mandali_invite(uuid) from public;
revoke all on function public.join_mandali_by_invite(text) from public;
revoke all on function public.remove_mandali_member(uuid, uuid) from public;
revoke all on function public.update_mandali(uuid, text, text, text, text) from public;
revoke all on function public.transfer_mandali_ownership(uuid, uuid) from public;
revoke all on function public.delete_mandali(uuid) from public;
grant execute on function public.create_mandali(text, text, text, text) to authenticated;
grant execute on function public.join_mandali(uuid) to authenticated;
grant execute on function public.leave_mandali(uuid) to authenticated;
grant execute on function public.create_mandali_invite(uuid) to authenticated;
grant execute on function public.join_mandali_by_invite(text) to authenticated;
grant execute on function public.remove_mandali_member(uuid, uuid) to authenticated;
grant execute on function public.update_mandali(uuid, text, text, text, text) to authenticated;
grant execute on function public.transfer_mandali_ownership(uuid, uuid) to authenticated;
grant execute on function public.delete_mandali(uuid) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'mandali_messages'
  ) then
    alter publication supabase_realtime add table public.mandali_messages;
  end if;
end;
$$;
