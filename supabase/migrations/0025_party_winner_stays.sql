-- In-room matching: complete teams queue by completion time. The host records
-- the winner; the winner stays on court and the loser returns to the queue.

create table public.party_team_queue (
  party_id uuid not null references public.party_rooms on delete cascade,
  team public.party_team not null,
  ready_at timestamptz not null default now(),
  queued_at timestamptz not null default now(),
  state text not null default 'waiting' check (state in ('waiting', 'playing')),
  primary key (party_id, team)
);

create table public.party_match_board (
  id uuid primary key default gen_random_uuid(),
  party_id uuid not null references public.party_rooms on delete cascade,
  round_no integer not null,
  team_a public.party_team not null,
  team_b public.party_team not null,
  winner public.party_team,
  status text not null default 'playing' check (status in ('playing', 'finished')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  unique (party_id, round_no),
  check (team_a <> team_b),
  check (winner is null or winner in (team_a, team_b))
);

create index party_team_queue_order_idx on public.party_team_queue (party_id, state, queued_at);
create index party_match_board_room_idx on public.party_match_board (party_id, round_no desc);

create or replace function public.refresh_party_team_queue() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_party uuid := case when tg_op = 'DELETE' then old.party_id else new.party_id end; v_team party_team;
begin
  foreach v_team in array enum_range(null::party_team) loop
    if (select count(*) from party_members where party_id = v_party and team = v_team and status = 'active') = 2 then
      insert into party_team_queue (party_id, team) values (v_party, v_team) on conflict (party_id, team) do nothing;
    else
      delete from party_team_queue where party_id = v_party and team = v_team;
    end if;
  end loop;
  return coalesce(new, old);
end $$;

create trigger party_members_refresh_queue after insert or update of team, status or delete
  on public.party_members for each row execute function public.refresh_party_team_queue();

insert into public.party_team_queue (party_id, team, ready_at, queued_at)
select party_id, team, max(joined_at), max(joined_at)
from public.party_members where status = 'active'
group by party_id, team having count(*) = 2
on conflict (party_id, team) do nothing;

-- p_winner is null to start the first match. Later calls must supply the winner
-- of the currently playing match.
create or replace function public.advance_party_match(p_party_id uuid, p_winner public.party_team default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_room party_rooms; v_current party_match_board; v_first party_team; v_next party_team; v_loser party_team; v_round integer;
begin
  select * into v_room from party_rooms where id = p_party_id for update;
  if not found or v_room.host_user_id <> auth.uid() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if v_room.status <> 'open' or v_room.ends_at <= now() then raise exception 'PARTY_NOT_OPEN' using errcode = '22023'; end if;

  select * into v_current from party_match_board where party_id = p_party_id and status = 'playing' order by round_no desc limit 1 for update;
  if found then
    if p_winner is null or p_winner not in (v_current.team_a, v_current.team_b) then raise exception 'INVALID_PARTY_WINNER' using errcode = '22023'; end if;
    v_loser := case when p_winner = v_current.team_a then v_current.team_b else v_current.team_a end;
    update party_match_board set winner = p_winner, status = 'finished', ended_at = now() where id = v_current.id;
    update party_team_queue set state = 'waiting', queued_at = now() where party_id = p_party_id and team = v_loser;
    update party_team_queue set state = 'playing' where party_id = p_party_id and team = p_winner;
    v_first := p_winner;
  else
    if p_winner is not null then raise exception 'NO_ACTIVE_PARTY_MATCH' using errcode = '22023'; end if;
    select team into v_first from party_team_queue where party_id = p_party_id order by (state = 'playing') desc, queued_at limit 1 for update;
  end if;

  if v_first is null then raise exception 'NOT_ENOUGH_READY_TEAMS' using errcode = '22023'; end if;
  select team into v_next from party_team_queue where party_id = p_party_id and team <> v_first and state = 'waiting' order by queued_at limit 1 for update;
  if v_next is null then return; end if;
  update party_team_queue set state = 'playing' where party_id = p_party_id and team in (v_first, v_next);
  select coalesce(max(round_no), 0) + 1 into v_round from party_match_board where party_id = p_party_id;
  insert into party_match_board (party_id, round_no, team_a, team_b) values (p_party_id, v_round, v_first, v_next);
end $$;

revoke execute on function public.refresh_party_team_queue() from public, anon, authenticated;
revoke execute on function public.advance_party_match(uuid, party_team) from public, anon;
grant execute on function public.advance_party_match(uuid, party_team) to authenticated;

alter table public.party_team_queue enable row level security;
alter table public.party_match_board enable row level security;
create policy "party team queue is public" on public.party_team_queue for select to anon, authenticated using (true);
create policy "party match board is public" on public.party_match_board for select to anon, authenticated using (true);
alter publication supabase_realtime add table public.party_team_queue, public.party_match_board;

notify pgrst, 'reload schema';
