create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default 'Friend' check (char_length(display_name) between 1 and 80),
  email text not null default '',
  avatar_seed text not null default 'Vartalaap',
  avatar_style text not null default 'lorelei',
  avatar_path text,
  created_at timestamptz not null default now()
);

create table if not exists public.direct_conversations (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references auth.users (id) on delete cascade,
  user_b uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint direct_conversations_distinct_users check (user_a < user_b),
  constraint direct_conversations_one_pair unique (user_a, user_b)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.direct_conversations (id) on delete cascade,
  sender_id uuid not null references auth.users (id) on delete cascade,
  content text not null check (char_length(btrim(content)) between 1 and 10000),
  created_at timestamptz not null default now()
);

create table if not exists public.ai_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  companion_name text not null default 'Mitra' check (char_length(companion_name) between 1 and 60),
  personality text not null default 'Warm, thoughtful, and easy to talk to.' check (char_length(personality) <= 500),
  instructions text not null default '' check (char_length(instructions) <= 4000),
  preferences text not null default '' check (char_length(preferences) <= 2000),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(btrim(content)) between 1 and 20000),
  created_at timestamptz not null default now()
);

create table if not exists public.ai_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  content text not null check (char_length(btrim(content)) between 1 and 500),
  category text not null default 'general' check (char_length(category) between 1 and 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ai_memories_no_duplicates unique (user_id, content),
  constraint ai_memories_no_credentials check (
    content !~* '\m(password|passcode|secret|api[ _-]?key|credential|token)\M'
  )
);

create index if not exists messages_conversation_created_idx
  on public.messages (conversation_id, created_at desc);
create index if not exists ai_messages_user_created_idx
  on public.ai_messages (user_id, created_at desc);
create index if not exists ai_memories_user_updated_idx
  on public.ai_memories (user_id, updated_at desc);

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, email, avatar_seed, avatar_style)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), 'Friend'),
    coalesce(new.email, ''),
    coalesce(nullif(new.raw_user_meta_data ->> 'avatar_seed', ''), 'Vartalaap'),
    coalesce(nullif(new.raw_user_meta_data ->> 'avatar_style', ''), 'lorelei')
  )
  on conflict (id) do update set
    email = excluded.email,
    display_name = excluded.display_name;

  insert into public.ai_profiles (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

alter table public.profiles enable row level security;
alter table public.direct_conversations enable row level security;
alter table public.messages enable row level security;
alter table public.ai_profiles enable row level security;
alter table public.ai_messages enable row level security;
alter table public.ai_memories enable row level security;

drop policy if exists "Profiles are private to their owner" on public.profiles;
drop policy if exists "Owners and conversation partners read profiles" on public.profiles;
create policy "Owners and conversation partners read profiles"
  on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1 from public.direct_conversations c
      where (c.user_a = (select auth.uid()) and c.user_b = profiles.id)
         or (c.user_b = (select auth.uid()) and c.user_a = profiles.id)
    )
  );
revoke update on public.profiles from authenticated;
grant update (avatar_seed, avatar_style, avatar_path) on public.profiles to authenticated;
drop policy if exists "Owners update their profile" on public.profiles;
create policy "Owners update their profile"
  on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

drop policy if exists "Participants read conversations" on public.direct_conversations;
create policy "Participants read conversations"
  on public.direct_conversations for select to authenticated
  using ((select auth.uid()) = user_a or (select auth.uid()) = user_b);

drop policy if exists "Participants read messages" on public.messages;
create policy "Participants read messages"
  on public.messages for select to authenticated
  using (
    exists (
      select 1 from public.direct_conversations c
      where c.id = conversation_id
        and ((select auth.uid()) = c.user_a or (select auth.uid()) = c.user_b)
    )
  );
drop policy if exists "Participants send their own messages" on public.messages;
create policy "Participants send their own messages"
  on public.messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and exists (
      select 1 from public.direct_conversations c
      where c.id = conversation_id
        and ((select auth.uid()) = c.user_a or (select auth.uid()) = c.user_b)
    )
  );

drop policy if exists "Owners manage AI profiles" on public.ai_profiles;
create policy "Owners manage AI profiles"
  on public.ai_profiles for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
drop policy if exists "Owners manage AI messages" on public.ai_messages;
create policy "Owners manage AI messages"
  on public.ai_messages for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
drop policy if exists "Owners manage AI memories" on public.ai_memories;
create policy "Owners manage AI memories"
  on public.ai_memories for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create or replace function public.search_profiles(p_query text)
returns setof public.profiles
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  search_term text := btrim(coalesce(p_query, ''));
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;
  if char_length(search_term) < 2 then
    return;
  end if;
  return query
    select p.*
    from public.profiles p
    where p.id <> auth.uid()
      and (
        p.display_name ilike '%' || search_term || '%'
        or p.email ilike '%' || search_term || '%'
      )
    order by p.display_name
    limit 20;
end;
$$;

create or replace function public.get_or_create_direct_conversation(p_other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  first_user_id uuid;
  second_user_id uuid;
  conversation_id uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;
  if p_other_user_id is null or p_other_user_id = current_user_id then
    raise exception 'Choose another registered user';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_other_user_id) then
    raise exception 'User not found';
  end if;

  first_user_id := least(current_user_id, p_other_user_id);
  second_user_id := greatest(current_user_id, p_other_user_id);
  insert into public.direct_conversations (user_a, user_b)
  values (first_user_id, second_user_id)
  on conflict (user_a, user_b) do nothing;

  select c.id into conversation_id
  from public.direct_conversations c
  where c.user_a = first_user_id and c.user_b = second_user_id;
  return conversation_id;
end;
$$;

revoke all on function public.search_profiles(text) from public;
grant execute on function public.search_profiles(text) to authenticated;
revoke all on function public.get_or_create_direct_conversation(uuid) from public;
grant execute on function public.get_or_create_direct_conversation(uuid) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 1048576, array['image/svg+xml'])
on conflict (id) do update set public = true;

drop policy if exists "Avatar images are publicly readable" on storage.objects;
create policy "Avatar images are publicly readable"
  on storage.objects for select
  using (bucket_id = 'avatars');
drop policy if exists "Users upload their own avatar" on storage.objects;
create policy "Users upload their own avatar"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "Users replace their own avatar" on storage.objects;
create policy "Users replace their own avatar"
  on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "Users delete their own avatar" on storage.objects;
create policy "Users delete their own avatar"
  on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end;
$$;
