-- Singles rooms use the same winner-stays-on flow as doubles, but each member
-- is one queue entry instead of waiting for a two-person team to be complete.

create table public.party_singles_queue (
  party_id uuid not null references public.party_rooms on delete cascade,
  entry_id uuid not null references public.party_members on delete cascade,
  name text not null,
  queued_at timestamptz not null default now(),
  state text not null default 'waiting' check (state in ('waiting', 'playing')),
  primary key (party_id, entry_id)
);

create table public.party_singles_match_board (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references public.party_rooms on delete cascade,
  round_no integer not null,
  player_a_entry uuid not null,
  player_a_name text not null,
  player_b_entry uuid not null,
  player_b_name text not null,
  winner_entry uuid,
  winner_name text,
  status text not null default 'playing' check (status in ('playing', 'finished')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  unique (party_id, round_no),
  check (player_a_entry <> player_b_entry),
  check (winner_entry is null or winner_entry in (player_a_entry, player_b_entry))
);

create index party_singles_queue_order_idx on public.party_singles_queue (party_id, state, queued_at);
create index party_singles_match_room_idx on public.party_singles_match_board (party_id, round_no desc);

-- This replaces the 0025 trigger function. It keeps doubles queues unchanged
-- and puts every active singles member into the queue immediately.
create or replace function public.refresh_party_team_queue() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_party uuid := case when tg_op = 'DELETE' then old.party_id else new.party_id end;
  v_mode party_mode;
  v_team party_team;
begin
  select mode into v_mode from party_rooms where id = v_party;
  if v_mode = 'singles' then
    delete from party_team_queue where party_id = v_party;
    insert into party_singles_queue (party_id, entry_id, name, queued_at)
    select party_id, id, name, joined_at from party_members
    where party_id = v_party and status = 'active'
    on conflict (party_id, entry_id) do update set name = excluded.name;
    delete from party_singles_queue q
    where q.party_id = v_party and not exists (
      select 1 from party_members m where m.id = q.entry_id and m.party_id = v_party and m.status = 'active'
    );
  else
    delete from party_singles_queue where party_id = v_party;
    foreach v_team in array enum_range(null::party_team) loop
      if (select count(*) from party_members where party_id = v_party and team = v_team and status = 'active') = 2 then
        insert into party_team_queue (party_id, team) values (v_party, v_team) on conflict (party_id, team) do nothing;
      else
        delete from party_team_queue where party_id = v_party and team = v_team;
      end if;
    end loop;
  end if;
  return coalesce(new, old);
end $$;

insert into public.party_singles_queue (party_id, entry_id, name, queued_at)
select m.party_id, m.id, m.name, m.joined_at
from public.party_members m join public.party_rooms r on r.id = m.party_id
where m.status = 'active' and r.mode = 'singles'
on conflict (party_id, entry_id) do nothing;

create or replace function public.advance_singles_match(p_party_id uuid, p_winner_entry uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_room party_rooms;
  v_current party_singles_match_board;
  v_first party_singles_queue;
  v_next party_singles_queue;
  v_loser uuid;
  v_round integer;
begin
  select * into v_room from party_rooms where id = p_party_id for update;
  if not found or v_room.host_user_id <> auth.uid() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if v_room.mode <> 'singles' then raise exception 'INVALID_PARTY_MODE' using errcode = '22023'; end if;
  if v_room.status <> 'open' or v_room.ends_at <= now() then raise exception 'PARTY_NOT_OPEN' using errcode = '22023'; end if;

  select * into v_current from party_singles_match_board
  where party_id = p_party_id and status = 'playing' order by round_no desc limit 1 for update;
  if found then
    if p_winner_entry is null or p_winner_entry not in (v_current.player_a_entry, v_current.player_b_entry) then
      raise exception 'INVALID_PARTY_WINNER' using errcode = '22023';
    end if;
    v_loser := case when p_winner_entry = v_current.player_a_entry then v_current.player_b_entry else v_current.player_a_entry end;
    update party_singles_match_board set winner_entry = p_winner_entry,
      winner_name = case when p_winner_entry = player_a_entry then player_a_name else player_b_name end,
      status = 'finished', ended_at = now() where id = v_current.id;
    update party_singles_queue set state = 'waiting', queued_at = now()
      where party_id = p_party_id and entry_id = v_loser;
    update party_singles_queue set state = 'playing'
      where party_id = p_party_id and entry_id = p_winner_entry;
    select * into v_first from party_singles_queue where party_id = p_party_id and entry_id = p_winner_entry for update;
  else
    if p_winner_entry is not null then raise exception 'NO_ACTIVE_PARTY_MATCH' using errcode = '22023'; end if;
    select * into v_first from party_singles_queue where party_id = p_party_id
      order by (state = 'playing') desc, queued_at limit 1 for update;
  end if;

  if v_first.entry_id is null then raise exception 'NOT_ENOUGH_READY_PLAYERS' using errcode = '22023'; end if;
  select * into v_next from party_singles_queue where party_id = p_party_id
    and entry_id <> v_first.entry_id and state = 'waiting' order by queued_at limit 1 for update;
  if v_next.entry_id is null then return; end if;
  update party_singles_queue set state = 'playing'
    where party_id = p_party_id and entry_id in (v_first.entry_id, v_next.entry_id);
  select coalesce(max(round_no), 0) + 1 into v_round from party_singles_match_board where party_id = p_party_id;
  insert into party_singles_match_board
    (party_id, round_no, player_a_entry, player_a_name, player_b_entry, player_b_name)
  values (p_party_id, v_round, v_first.entry_id, v_first.name, v_next.entry_id, v_next.name);
end $$;

revoke execute on function public.advance_singles_match(uuid, uuid) from public, anon;
grant execute on function public.advance_singles_match(uuid, uuid) to authenticated;

alter table public.party_singles_queue enable row level security;
alter table public.party_singles_match_board enable row level security;
create policy "party singles queue is public" on public.party_singles_queue for select to anon, authenticated using (true);
create policy "party singles matches are public" on public.party_singles_match_board for select to anon, authenticated using (true);
alter publication supabase_realtime add table public.party_singles_queue, public.party_singles_match_board;

notify pgrst, 'reload schema';
