create table if not exists public.mandali_games (
  id uuid primary key default gen_random_uuid(),
  mandali_id uuid not null references public.mandalis (id) on delete cascade,
  created_by uuid not null references auth.users (id) on delete cascade,
  player_x uuid not null references auth.users (id) on delete cascade,
  player_o uuid references auth.users (id) on delete set null,
  board text[] not null default array[null, null, null, null, null, null, null, null, null]::text[],
  status text not null default 'waiting' check (status in ('waiting', 'playing', 'won', 'draw')),
  next_turn uuid references auth.users (id) on delete set null,
  winner_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint mandali_games_board_size check (cardinality(board) = 9)
);

create index if not exists mandali_games_room_idx
  on public.mandali_games (mandali_id, created_at desc);

alter table public.mandali_games enable row level security;
revoke all on public.mandali_games from anon, authenticated;
grant select on public.mandali_games to authenticated;

drop policy if exists "Mandali members read games" on public.mandali_games;
create policy "Mandali members read games"
  on public.mandali_games for select to authenticated
  using ((select public.is_mandali_member(mandali_id)));

create or replace function public.create_mandali_ttt_game(p_mandali_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  game_id uuid;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  if not public.is_mandali_member(p_mandali_id) then
    raise exception 'Join this Mandali before starting a game';
  end if;
  insert into public.mandali_games (mandali_id, created_by, player_x, next_turn)
  values (
    p_mandali_id,
    current_user_id,
    current_user_id,
    current_user_id
  )
  returning id into game_id;
  return game_id;
end;
$$;

create or replace function public.join_mandali_ttt_game(p_game_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  game_mandali_id uuid;
begin
  if current_user_id is null then raise exception 'Authentication required'; end if;
  select mandali_id into game_mandali_id
  from public.mandali_games
  where id = p_game_id;
  if game_mandali_id is null then raise exception 'Game room not found'; end if;
  if not public.is_mandali_member(game_mandali_id) then
    raise exception 'Only Mandali members can join this game';
  end if;

  update public.mandali_games
  set player_o = current_user_id,
      status = 'playing',
      updated_at = now()
  where id = p_game_id
    and status = 'waiting'
    and player_x <> current_user_id;
  if not found then
    raise exception 'This game is no longer waiting for a player';
  end if;
  return p_game_id;
end;
$$;

create or replace function public.play_mandali_ttt_move(p_game_id uuid, p_cell integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  game_row public.mandali_games%rowtype;
  marker text;
  next_user_id uuid;
  winning_line integer[];
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  select * into game_row
  from public.mandali_games
  where id = p_game_id
  for update;
  if not found then raise exception 'Game room not found'; end if;
  if not public.is_mandali_member(game_row.mandali_id) then
    raise exception 'Only Mandali members can play this game';
  end if;
  if game_row.status <> 'playing' then raise exception 'This game is not in progress'; end if;
  if auth.uid() <> game_row.player_x and auth.uid() <> game_row.player_o then
    raise exception 'You are not a player in this game';
  end if;
  if game_row.next_turn <> auth.uid() then raise exception 'Wait for your turn'; end if;
  if p_cell is null or p_cell < 0 or p_cell > 8 then raise exception 'Choose a valid square'; end if;
  if game_row.board[p_cell + 1] is not null then raise exception 'That square is already taken'; end if;

  marker := case when auth.uid() = game_row.player_x then 'x' else 'o' end;
  game_row.board[p_cell + 1] := marker;
  next_user_id := case when auth.uid() = game_row.player_x then game_row.player_o else game_row.player_x end;
  winning_line := case
    when game_row.board[1] = marker and game_row.board[2] = marker and game_row.board[3] = marker then array[1, 2, 3]
    when game_row.board[4] = marker and game_row.board[5] = marker and game_row.board[6] = marker then array[4, 5, 6]
    when game_row.board[7] = marker and game_row.board[8] = marker and game_row.board[9] = marker then array[7, 8, 9]
    when game_row.board[1] = marker and game_row.board[4] = marker and game_row.board[7] = marker then array[1, 4, 7]
    when game_row.board[2] = marker and game_row.board[5] = marker and game_row.board[8] = marker then array[2, 5, 8]
    when game_row.board[3] = marker and game_row.board[6] = marker and game_row.board[9] = marker then array[3, 6, 9]
    when game_row.board[1] = marker and game_row.board[5] = marker and game_row.board[9] = marker then array[1, 5, 9]
    when game_row.board[3] = marker and game_row.board[5] = marker and game_row.board[7] = marker then array[3, 5, 7]
    else null
  end;

  update public.mandali_games
  set board = game_row.board,
      status = case
        when winning_line is not null then 'won'
        when array_position(game_row.board, null) is null then 'draw'
        else 'playing'
      end,
      winner_id = case when winning_line is not null then auth.uid() else null end,
      next_turn = case when winning_line is not null or array_position(game_row.board, null) is null then null else next_user_id end,
      updated_at = now()
  where id = p_game_id;
end;
$$;

revoke all on function public.create_mandali_ttt_game(uuid) from anon, public;
revoke all on function public.join_mandali_ttt_game(uuid) from anon, public;
revoke all on function public.play_mandali_ttt_move(uuid, integer) from anon, public;
grant execute on function public.create_mandali_ttt_game(uuid) to authenticated;
grant execute on function public.join_mandali_ttt_game(uuid) to authenticated;
grant execute on function public.play_mandali_ttt_move(uuid, integer) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'mandali_games'
  ) then
    alter publication supabase_realtime add table public.mandali_games;
  end if;
end;
$$;
