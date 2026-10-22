-- 0018_play_queue.sql
-- Per-court play queue (คิวก๊วน): players line up for a court, an admin sends the next
-- group on. No money moves here; court time is still booked through bookings.
--
-- Same shape as bookings -> court_occupancy: queue_entries is private (it holds the
-- user id), queue_board is a public, PII-free mirror kept by a trigger for realtime.

create table if not exists public.court_queues (
  court_id         smallint primary key references public.courts,
  is_open          boolean  not null default false,
  players_per_game smallint not null default 4 check (players_per_game between 2 and 4),
  updated_at       timestamptz not null default now()
);

insert into public.court_queues (court_id) select id from public.courts on conflict do nothing;

create table if not exists public.queue_entries (
  id          uuid primary key default gen_random_uuid(),
  court_id    smallint    not null references public.courts,
  user_id     uuid        references auth.users on delete set null, -- null: added by an admin
  name        text        not null check (char_length(name) between 1 and 30),
  status      text        not null default 'waiting' check (status in ('waiting', 'playing', 'done', 'left')),
  queued_at   timestamptz not null default now(), -- order in the line; reset when sent to the back
  called_at   timestamptz,
  finished_at timestamptz,
  created_by  uuid        references auth.users on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists queue_entries_court_idx on public.queue_entries (court_id, status, queued_at);
create index if not exists queue_entries_user_idx on public.queue_entries (user_id, created_at desc);
-- One place at a time per person, across every court.
create unique index if not exists queue_entries_one_active_per_user on public.queue_entries (user_id)
  where user_id is not null and status in ('waiting', 'playing');

create table if not exists public.queue_board (
  entry_id  uuid primary key references public.queue_entries on delete cascade,
  court_id  smallint    not null,
  name      text        not null,
  status    text        not null,
  queued_at timestamptz not null,
  called_at timestamptz
);

create index if not exists queue_board_court_idx on public.queue_board (court_id, queued_at);
alter table public.queue_board replica identity full; -- DELETE events carry the row

create or replace function public.sync_queue_board() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('waiting', 'playing') then
    insert into queue_board (entry_id, court_id, name, status, queued_at, called_at)
    values (new.id, new.court_id, new.name, new.status, new.queued_at, new.called_at)
    on conflict (entry_id) do update
      set status = excluded.status, queued_at = excluded.queued_at, called_at = excluded.called_at;
  else
    delete from queue_board where entry_id = new.id;
  end if;
  return new;
end $$;

drop trigger if exists queue_entries_sync_board on public.queue_entries;
create trigger queue_entries_sync_board
  after insert or update of status, queued_at, called_at on public.queue_entries
  for each row execute function public.sync_queue_board();

-- A queue lives for one Bangkok day. Places left from an earlier day end the next time
-- anyone touches the queue, so a forgotten queue never blocks someone from joining.
create or replace function public.end_stale_queue_entries() returns void
language sql security definer set search_path = public as $$
  update queue_entries
  set status = case when status = 'playing' then 'done' else 'left' end, finished_at = now()
  where status in ('waiting', 'playing')
    and queued_at < (date_trunc('day', now() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok')
$$;

create or replace function public.clean_queue_name(p_name text) returns text
language plpgsql immutable as $$
declare
  v_name text := left(regexp_replace(trim(coalesce(p_name, '')), '\s+', ' ', 'g'), 30);
begin
  if v_name = '' then
    raise exception 'INVALID_NAME' using errcode = '22023';
  end if;
  return v_name;
end $$;

-- ---------------------------------------------------------------------------
-- Customer RPCs
-- ---------------------------------------------------------------------------

create or replace function public.join_queue(p_court_id smallint, p_name text)
returns public.queue_entries
language plpgsql security definer set search_path = public as $$
declare
  c_max_per_hour constant int := 20;
  v_uid uuid := auth.uid();
  v_row queue_entries;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;
  perform end_stale_queue_entries();

  if not coalesce((select is_open from court_queues where court_id = p_court_id), false) then
    raise exception 'QUEUE_CLOSED' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));
  if (select count(*) from queue_entries
      where user_id = v_uid and created_at > now() - interval '1 hour') >= c_max_per_hour then
    raise exception 'TOO_MANY_QUEUE_JOINS' using errcode = '22023';
  end if;

  begin
    insert into queue_entries (court_id, user_id, name, created_by)
    values (p_court_id, v_uid, clean_queue_name(p_name), v_uid)
    returning * into v_row;
  exception when unique_violation then
    raise exception 'ALREADY_IN_QUEUE' using errcode = '23505';
  end;
  return v_row;
end $$;

create or replace function public.leave_queue(p_entry_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update queue_entries
  set status = case when status = 'playing' then 'done' else 'left' end, finished_at = now()
  where id = p_entry_id
    and (user_id = auth.uid() or is_admin())
    and status in ('waiting', 'playing');
  if not found then
    raise exception 'QUEUE_ENTRY_NOT_FOUND' using errcode = 'P0002';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Admin RPCs
-- ---------------------------------------------------------------------------

create or replace function public.set_court_queue(p_court_id smallint, p_is_open boolean, p_players_per_game smallint)
returns public.court_queues
language plpgsql security definer set search_path = public as $$
declare
  v_row court_queues;
begin
  if not is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_players_per_game is null or p_players_per_game not between 2 and 4 then
    raise exception 'INVALID_PLAYERS_PER_GAME' using errcode = '22023';
  end if;
  if not exists (select 1 from courts where id = p_court_id) then
    raise exception 'COURT_NOT_FOUND' using errcode = 'P0002';
  end if;

  insert into court_queues (court_id, is_open, players_per_game, updated_at)
  values (p_court_id, coalesce(p_is_open, false), p_players_per_game, now())
  on conflict (court_id) do update
    set is_open = excluded.is_open, players_per_game = excluded.players_per_game, updated_at = now()
  returning * into v_row;

  -- Closing ends the night: nobody stays in a line that no longer exists.
  if not v_row.is_open then
    update queue_entries
    set status = case when status = 'playing' then 'done' else 'left' end, finished_at = now()
    where court_id = p_court_id and status in ('waiting', 'playing');
  end if;
  return v_row;
end $$;

-- A walk-in without an account: the admin types the name.
create or replace function public.admin_add_to_queue(p_court_id smallint, p_name text)
returns public.queue_entries
language plpgsql security definer set search_path = public as $$
declare
  v_row queue_entries;
begin
  if not is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  perform end_stale_queue_entries();
  if not coalesce((select is_open from court_queues where court_id = p_court_id), false) then
    raise exception 'QUEUE_CLOSED' using errcode = '22023';
  end if;

  insert into queue_entries (court_id, name, created_by)
  values (p_court_id, clean_queue_name(p_name), auth.uid())
  returning * into v_row;
  return v_row;
end $$;

-- Current players finish; the next players_per_game waiting go on. Returns how many went on.
create or replace function public.queue_next_game(p_court_id smallint)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_per_game smallint;
  v_called   int;
begin
  if not is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  perform end_stale_queue_entries();
  -- Two admins pressing at once must not call two games.
  perform pg_advisory_xact_lock(hashtextextended('queue:' || p_court_id::text, 0));

  select players_per_game into v_per_game from court_queues where court_id = p_court_id and is_open;
  if not found then
    raise exception 'QUEUE_CLOSED' using errcode = '22023';
  end if;

  update queue_entries set status = 'done', finished_at = now()
  where court_id = p_court_id and status = 'playing';

  with nxt as (
    select id from queue_entries
    where court_id = p_court_id and status = 'waiting'
    order by queued_at, created_at
    limit v_per_game
    for update
  ), called as (
    update queue_entries q set status = 'playing', called_at = now()
    from nxt where q.id = nxt.id
    returning 1
  )
  select count(*)::int into v_called from called;
  return v_called;
end $$;

-- play: put one waiting player on now; back: send to the end of the line;
-- done: finished playing; remove: take out of the queue.
create or replace function public.queue_entry_action(p_entry_id uuid, p_action text)
returns public.queue_entries
language plpgsql security definer set search_path = public as $$
declare
  v_row queue_entries;
begin
  if not is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select * into v_row from queue_entries
  where id = p_entry_id and status in ('waiting', 'playing')
  for update;
  if not found then
    raise exception 'QUEUE_ENTRY_NOT_FOUND' using errcode = 'P0002';
  end if;

  if p_action = 'play' and v_row.status = 'waiting' then
    update queue_entries set status = 'playing', called_at = now() where id = p_entry_id returning * into v_row;
  elsif p_action = 'back' then
    update queue_entries set status = 'waiting', queued_at = now(), called_at = null
    where id = p_entry_id returning * into v_row;
  elsif p_action = 'done' and v_row.status = 'playing' then
    update queue_entries set status = 'done', finished_at = now() where id = p_entry_id returning * into v_row;
  elsif p_action = 'remove' then
    update queue_entries set status = 'left', finished_at = now() where id = p_entry_id returning * into v_row;
  else
    raise exception 'INVALID_QUEUE_ACTION' using errcode = '22023';
  end if;
  return v_row;
end $$;

-- ---------------------------------------------------------------------------
-- Privileges & RLS
-- ---------------------------------------------------------------------------

revoke execute on function public.sync_queue_board() from public, anon, authenticated;
revoke execute on function public.end_stale_queue_entries() from public, anon, authenticated;
revoke execute on function public.join_queue(smallint, text) from public, anon;
revoke execute on function public.leave_queue(uuid) from public, anon;
revoke execute on function public.set_court_queue(smallint, boolean, smallint) from public, anon;
revoke execute on function public.admin_add_to_queue(smallint, text) from public, anon;
revoke execute on function public.queue_next_game(smallint) from public, anon;
revoke execute on function public.queue_entry_action(uuid, text) from public, anon;
grant execute on function public.join_queue(smallint, text) to authenticated;
grant execute on function public.leave_queue(uuid) to authenticated;
grant execute on function public.set_court_queue(smallint, boolean, smallint) to authenticated;
grant execute on function public.admin_add_to_queue(smallint, text) to authenticated;
grant execute on function public.queue_next_game(smallint) to authenticated;
grant execute on function public.queue_entry_action(uuid, text) to authenticated;

alter table public.court_queues  enable row level security;
alter table public.queue_entries enable row level security;
alter table public.queue_board   enable row level security;

drop policy if exists "court queues are public" on public.court_queues;
create policy "court queues are public" on public.court_queues
  for select to anon, authenticated using (true);

drop policy if exists "queue board is public" on public.queue_board;
create policy "queue board is public" on public.queue_board
  for select to anon, authenticated using (true);

drop policy if exists "read own queue entries or admin" on public.queue_entries;
create policy "read own queue entries or admin" on public.queue_entries
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

alter publication supabase_realtime add table public.queue_board, public.court_queues;
