-- 0029_party_matchmaking.sql
--
-- Turns "winner stays on" into a real matchmaker, the way an online game does it.
--
-- Until now the next challenger was simply whoever had waited longest, and a strong
-- player could hold the court all night while the people who paid for the same court
-- watched. Three things change that:
--
--   1. A LADDER. Every player carries a rating (starts at 1000) that moves after each
--      game by the Elo formula: beating someone far above you is worth a lot, beating
--      someone far below you is worth almost nothing. Ratings persist between ก๊วน
--      nights, so the ladder means something.
--
--   2. A MATCHMAKER. The challenger is chosen, not just queued. Court time comes first
--      (fewest games played goes on next), and among players with equal court time the
--      closest rating to the holder is picked, so the game is worth watching. Anyone
--      left waiting past the room's fair-wait window jumps ahead of all of that — the
--      same "widen the search until nobody is stuck" rule a game queue uses.
--
--   3. LIMITS THAT KEEP IT FUN. A holder who wins `win_streak_cap` games in a row must
--      rest, and the player who just lost is not fed straight back to the same opponent
--      while other people are waiting.
--
-- Everything is decided inside these functions, so two phones tapping at once cannot
-- produce two different next matches: the room row is locked first, exactly as before.

-- ---------------------------------------------------------------------------
-- The ladder. Keyed by user, so it carries across rooms and across nights.
-- It holds a user id, so it is never part of a public board: a player sees only
-- their own row, and the room screens read the copy in party_player_stats.
-- ---------------------------------------------------------------------------
create table public.player_ratings (
  user_id     uuid primary key references auth.users on delete cascade,
  rating      integer not null default 1000 check (rating between 100 and 4000),
  played      integer not null default 0,
  wins        integer not null default 0,
  best_streak integer not null default 0,
  updated_at  timestamptz not null default now()
);

alter table public.player_ratings enable row level security;
create policy "a player reads their own rating" on public.player_ratings
  for select to authenticated using (user_id = auth.uid());
create policy "admins read every rating" on public.player_ratings
  for select to authenticated using (is_admin());

-- ---------------------------------------------------------------------------
-- What one room's scoreboard shows. Keyed by entry_id, which the party boards
-- already expose, so this table carries no user id and can be public.
-- ---------------------------------------------------------------------------
create table public.party_player_stats (
  party_id     uuid not null references public.party_rooms on delete cascade,
  entry_id     uuid not null references public.party_members on delete cascade,
  name         text not null,
  rating       integer not null default 1000,
  rating_delta integer not null default 0,
  played       integer not null default 0,
  wins         integer not null default 0,
  losses       integer not null default 0,
  streak       integer not null default 0,
  best_streak  integer not null default 0,
  primary key (party_id, entry_id)
);

create index party_player_stats_room_idx on public.party_player_stats (party_id, played, rating);

alter table public.party_player_stats enable row level security;
create policy "party player stats are public" on public.party_player_stats
  for select to anon, authenticated using (true);

-- ---------------------------------------------------------------------------
-- Room rules the host can set, and the running totals a team carries.
-- ---------------------------------------------------------------------------
alter table public.party_rooms
  add column if not exists win_streak_cap smallint not null default 3
    check (win_streak_cap between 1 and 10),
  add column if not exists fair_wait_seconds integer not null default 900
    check (fair_wait_seconds between 60 and 7200);

alter table public.party_team_queue
  add column if not exists played  integer not null default 0,
  add column if not exists wins    integer not null default 0,
  add column if not exists streak  integer not null default 0,
  add column if not exists rating  integer not null default 1000;

-- The room board is what the page reads, so the rules have to reach it.
alter table public.party_room_board
  add column if not exists win_streak_cap smallint not null default 3;

-- ---------------------------------------------------------------------------
-- Elo. Pure arithmetic, so it can be read and checked on its own.
-- K = 24: a win against an equal player moves the rating by 12 points.
-- ---------------------------------------------------------------------------
create or replace function public.party_elo_delta(p_rating integer, p_opponent integer, p_won boolean)
returns integer language sql immutable as $$
  select round(24 * ((case when p_won then 1.0 else 0.0 end)
                     - 1.0 / (1.0 + power(10.0, (p_opponent - p_rating) / 400.0))))::integer
$$;

-- ---------------------------------------------------------------------------
-- Keep the scoreboard in step with who is actually in the room.
-- A player who joins picks up their ladder rating; a player who leaves is dropped.
-- ---------------------------------------------------------------------------
create or replace function public.sync_party_player_stats(p_party_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into party_player_stats (party_id, entry_id, name, rating)
  select m.party_id, m.id, m.name, coalesce(r.rating, 1000)
  from party_members m
  left join player_ratings r on r.user_id = m.user_id
  where m.party_id = p_party_id and m.status = 'active'
  on conflict (party_id, entry_id) do update set name = excluded.name;

  delete from party_player_stats s
  where s.party_id = p_party_id and not exists (
    select 1 from party_members m
    where m.id = s.entry_id and m.party_id = p_party_id and m.status = 'active'
  );

  -- A team is as strong as the two players in it.
  update party_team_queue q
  set rating = coalesce((
    select round(avg(s.rating))::integer
    from party_members m join party_player_stats s on s.entry_id = m.id
    where m.party_id = q.party_id and m.team = q.team and m.status = 'active'
  ), 1000)
  where q.party_id = p_party_id;
end $$;

-- This replaces the 0028 trigger function. Same queue behaviour, and it now also
-- keeps the scoreboard and the team ratings in step.
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
  perform sync_party_player_stats(v_party);
  return coalesce(new, old);
end $$;

-- Rooms that already exist get a scoreboard.
insert into public.party_player_stats (party_id, entry_id, name, rating)
select m.party_id, m.id, m.name, 1000
from public.party_members m
where m.status = 'active'
on conflict (party_id, entry_id) do nothing;

update public.party_room_board b
set win_streak_cap = r.win_streak_cap
from public.party_rooms r where r.id = b.party_id;

-- ---------------------------------------------------------------------------
-- Record one finished game: ratings, counters, streaks, ladder.
-- ---------------------------------------------------------------------------
create or replace function public.record_party_result(
  p_party_id uuid, p_winner_entry uuid, p_loser_entry uuid
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_win_rating integer;
  v_lose_rating integer;
  v_delta integer;
  v_winner_user uuid;
  v_loser_user uuid;
begin
  select rating into v_win_rating from party_player_stats
    where party_id = p_party_id and entry_id = p_winner_entry;
  select rating into v_lose_rating from party_player_stats
    where party_id = p_party_id and entry_id = p_loser_entry;
  if v_win_rating is null or v_lose_rating is null then return; end if;

  -- One number moves both ways, so the ladder never invents or loses points.
  v_delta := greatest(1, party_elo_delta(v_win_rating, v_lose_rating, true));

  update party_player_stats
  set rating = rating + v_delta, rating_delta = rating_delta + v_delta,
      played = played + 1, wins = wins + 1,
      streak = streak + 1, best_streak = greatest(best_streak, streak + 1)
  where party_id = p_party_id and entry_id = p_winner_entry;

  update party_player_stats
  set rating = greatest(100, rating - v_delta), rating_delta = rating_delta - v_delta,
      played = played + 1, losses = losses + 1, streak = 0
  where party_id = p_party_id and entry_id = p_loser_entry;

  select user_id into v_winner_user from party_members where id = p_winner_entry;
  select user_id into v_loser_user from party_members where id = p_loser_entry;

  insert into player_ratings (user_id, rating, played, wins, best_streak)
  select v_winner_user, least(4000, 1000 + v_delta), 1, 1,
         (select streak from party_player_stats where party_id = p_party_id and entry_id = p_winner_entry)
  where v_winner_user is not null
  on conflict (user_id) do update set
    rating = least(4000, player_ratings.rating + v_delta),
    played = player_ratings.played + 1,
    wins = player_ratings.wins + 1,
    best_streak = greatest(player_ratings.best_streak,
      (select streak from party_player_stats where party_id = p_party_id and entry_id = p_winner_entry)),
    updated_at = now();

  insert into player_ratings (user_id, rating, played, wins)
  select v_loser_user, greatest(100, 1000 - v_delta), 1, 0
  where v_loser_user is not null
  on conflict (user_id) do update set
    rating = greatest(100, player_ratings.rating - v_delta),
    played = player_ratings.played + 1,
    updated_at = now();
end $$;

-- ---------------------------------------------------------------------------
-- The matchmaker for a singles room.
--
-- `p_holder` is the player staying on court (null when the court is empty), and
-- `p_avoid` is the opponent of the game that just ended. Reading the ORDER BY from
-- the top is the whole rule, in order of what matters:
--   1. waited past the room's fair-wait window  -> nobody is left behind
--   2. fewest games played                      -> the court is shared
--   3. rating closest to the holder             -> the game is worth watching
--   4. waiting longest, then entry id           -> settled, never random
-- ---------------------------------------------------------------------------
create or replace function public.pick_singles_challenger(
  p_party_id uuid, p_holder uuid, p_avoid uuid
) returns uuid language plpgsql stable security definer set search_path = public as $$
declare
  v_fair integer;
  v_holder_rating integer;
  v_others integer;
  v_pick uuid;
begin
  select fair_wait_seconds into v_fair from party_rooms where id = p_party_id;
  select rating into v_holder_rating from party_player_stats
    where party_id = p_party_id and entry_id = p_holder;
  v_holder_rating := coalesce(v_holder_rating, 1000);

  -- Only refuse an instant rematch when somebody else is actually free to play.
  select count(*) into v_others from party_singles_queue q
  where q.party_id = p_party_id and q.state = 'waiting'
    and q.entry_id is distinct from p_holder and q.entry_id is distinct from p_avoid;

  select q.entry_id into v_pick
  from party_singles_queue q
  join party_player_stats s on s.party_id = q.party_id and s.entry_id = q.entry_id
  where q.party_id = p_party_id
    and q.state = 'waiting'
    and q.entry_id is distinct from p_holder
    and (v_others = 0 or q.entry_id is distinct from p_avoid)
  order by
    (extract(epoch from (now() - q.queued_at)) >= coalesce(v_fair, 900)) desc,
    s.played asc,
    abs(s.rating - v_holder_rating) asc,
    q.queued_at asc,
    q.entry_id asc
  limit 1;

  return v_pick;
end $$;

-- ---------------------------------------------------------------------------
-- Singles: finish the game on court (if any), then make the next one.
-- Replaces the version from 0028.
-- ---------------------------------------------------------------------------
create or replace function public.advance_singles_match(p_party_id uuid, p_winner_entry uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_room party_rooms;
  v_current party_singles_match_board;
  v_holder uuid;
  v_avoid uuid;
  v_next uuid;
  v_loser uuid;
  v_streak integer;
  v_round integer;
  v_holder_name text;
  v_next_name text;
begin
  select * into v_room from party_rooms where id = p_party_id for update;
  if not found or v_room.host_user_id <> auth.uid() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if v_room.mode <> 'singles' then raise exception 'INVALID_PARTY_MODE' using errcode = '22023'; end if;
  if v_room.status <> 'open' or v_room.ends_at <= now() then raise exception 'PARTY_NOT_OPEN' using errcode = '22023'; end if;

  perform sync_party_player_stats(p_party_id);

  select * into v_current from party_singles_match_board
  where party_id = p_party_id and status = 'playing' order by round_no desc limit 1 for update;

  if found then
    if p_winner_entry is null or p_winner_entry not in (v_current.player_a_entry, v_current.player_b_entry) then
      raise exception 'INVALID_PARTY_WINNER' using errcode = '22023';
    end if;
    v_loser := case when p_winner_entry = v_current.player_a_entry
                    then v_current.player_b_entry else v_current.player_a_entry end;

    update party_singles_match_board set winner_entry = p_winner_entry,
      winner_name = case when p_winner_entry = player_a_entry then player_a_name else player_b_name end,
      status = 'finished', ended_at = now() where id = v_current.id;

    perform record_party_result(p_party_id, p_winner_entry, v_loser);

    update party_singles_queue set state = 'waiting', queued_at = now()
      where party_id = p_party_id and entry_id = v_loser;

    select streak into v_streak from party_player_stats
      where party_id = p_party_id and entry_id = p_winner_entry;

    if v_streak >= v_room.win_streak_cap then
      -- Held the court long enough. Rest at the back; the next game is a fresh pair.
      update party_singles_queue set state = 'waiting', queued_at = now()
        where party_id = p_party_id and entry_id = p_winner_entry;
      update party_player_stats set streak = 0
        where party_id = p_party_id and entry_id = p_winner_entry;
      v_holder := null;
    else
      update party_singles_queue set state = 'playing'
        where party_id = p_party_id and entry_id = p_winner_entry;
      v_holder := p_winner_entry;
      v_avoid := v_loser;
    end if;
  else
    if p_winner_entry is not null then raise exception 'NO_ACTIVE_PARTY_MATCH' using errcode = '22023'; end if;
    select entry_id into v_holder from party_singles_queue
      where party_id = p_party_id and state = 'playing' limit 1 for update;
  end if;

  -- With the court empty, the matchmaker also chooses who goes on first.
  if v_holder is null then
    v_holder := pick_singles_challenger(p_party_id, null, null);
    if v_holder is null then raise exception 'NOT_ENOUGH_READY_PLAYERS' using errcode = '22023'; end if;
  end if;

  v_next := pick_singles_challenger(p_party_id, v_holder, v_avoid);
  if v_next is null then
    -- Nobody to play: the holder waits on court and the room shows that.
    update party_singles_queue set state = 'playing'
      where party_id = p_party_id and entry_id = v_holder;
    return;
  end if;

  update party_singles_queue set state = 'playing'
    where party_id = p_party_id and entry_id in (v_holder, v_next);
  select name into v_holder_name from party_singles_queue where party_id = p_party_id and entry_id = v_holder;
  select name into v_next_name from party_singles_queue where party_id = p_party_id and entry_id = v_next;
  select coalesce(max(round_no), 0) + 1 into v_round from party_singles_match_board where party_id = p_party_id;
  insert into party_singles_match_board
    (party_id, round_no, player_a_entry, player_a_name, player_b_entry, player_b_name)
  values (p_party_id, v_round, v_holder, v_holder_name, v_next, v_next_name);
end $$;

-- ---------------------------------------------------------------------------
-- The same matchmaker for a doubles room, at team level.
-- ---------------------------------------------------------------------------
create or replace function public.pick_team_challenger(
  p_party_id uuid, p_holder public.party_team, p_avoid public.party_team
) returns public.party_team language plpgsql stable security definer set search_path = public as $$
declare
  v_fair integer;
  v_holder_rating integer;
  v_others integer;
  v_pick party_team;
begin
  select fair_wait_seconds into v_fair from party_rooms where id = p_party_id;
  select rating into v_holder_rating from party_team_queue
    where party_id = p_party_id and team = p_holder;
  v_holder_rating := coalesce(v_holder_rating, 1000);

  select count(*) into v_others from party_team_queue q
  where q.party_id = p_party_id and q.state = 'waiting'
    and q.team is distinct from p_holder and q.team is distinct from p_avoid;

  select q.team into v_pick
  from party_team_queue q
  where q.party_id = p_party_id
    and q.state = 'waiting'
    and q.team is distinct from p_holder
    and (v_others = 0 or q.team is distinct from p_avoid)
  order by
    (extract(epoch from (now() - q.queued_at)) >= coalesce(v_fair, 900)) desc,
    q.played asc,
    abs(q.rating - v_holder_rating) asc,
    q.queued_at asc,
    q.team asc
  limit 1;

  return v_pick;
end $$;

create or replace function public.advance_party_match(p_party_id uuid, p_winner public.party_team default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_room party_rooms;
  v_current party_match_board;
  v_holder party_team;
  v_avoid party_team;
  v_next party_team;
  v_loser party_team;
  v_streak integer;
  v_round integer;
  v_win_member record;
  v_lose_member record;
begin
  select * into v_room from party_rooms where id = p_party_id for update;
  if not found or v_room.host_user_id <> auth.uid() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if v_room.mode <> 'doubles' then raise exception 'INVALID_PARTY_MODE' using errcode = '22023'; end if;
  if v_room.status <> 'open' or v_room.ends_at <= now() then raise exception 'PARTY_NOT_OPEN' using errcode = '22023'; end if;

  perform sync_party_player_stats(p_party_id);

  select * into v_current from party_match_board
  where party_id = p_party_id and status = 'playing' order by round_no desc limit 1 for update;

  if found then
    if p_winner is null or p_winner not in (v_current.team_a, v_current.team_b) then
      raise exception 'INVALID_PARTY_WINNER' using errcode = '22023';
    end if;
    v_loser := case when p_winner = v_current.team_a then v_current.team_b else v_current.team_a end;
    update party_match_board set winner = p_winner, status = 'finished', ended_at = now() where id = v_current.id;

    -- Every player on the winning team beats every player on the losing team, so a
    -- doubles game moves four ratings by the same amount a singles game moves two.
    for v_win_member in
      select m.id from party_members m
      where m.party_id = p_party_id and m.team = p_winner and m.status = 'active'
    loop
      for v_lose_member in
        select m.id from party_members m
        where m.party_id = p_party_id and m.team = v_loser and m.status = 'active'
      loop
        perform record_party_result(p_party_id, v_win_member.id, v_lose_member.id);
      end loop;
    end loop;

    update party_team_queue set played = played + 1, wins = wins + 1, streak = streak + 1
      where party_id = p_party_id and team = p_winner;
    update party_team_queue set played = played + 1, streak = 0, state = 'waiting', queued_at = now()
      where party_id = p_party_id and team = v_loser;

    select streak into v_streak from party_team_queue where party_id = p_party_id and team = p_winner;
    if v_streak >= v_room.win_streak_cap then
      update party_team_queue set state = 'waiting', queued_at = now(), streak = 0
        where party_id = p_party_id and team = p_winner;
      v_holder := null;
    else
      update party_team_queue set state = 'playing' where party_id = p_party_id and team = p_winner;
      v_holder := p_winner;
      v_avoid := v_loser;
    end if;
  else
    if p_winner is not null then raise exception 'NO_ACTIVE_PARTY_MATCH' using errcode = '22023'; end if;
    select team into v_holder from party_team_queue
      where party_id = p_party_id and state = 'playing' limit 1 for update;
  end if;

  perform sync_party_player_stats(p_party_id);

  if v_holder is null then
    v_holder := pick_team_challenger(p_party_id, null, null);
    if v_holder is null then raise exception 'NOT_ENOUGH_READY_TEAMS' using errcode = '22023'; end if;
  end if;

  v_next := pick_team_challenger(p_party_id, v_holder, v_avoid);
  if v_next is null then
    update party_team_queue set state = 'playing' where party_id = p_party_id and team = v_holder;
    return;
  end if;

  update party_team_queue set state = 'playing' where party_id = p_party_id and team in (v_holder, v_next);
  select coalesce(max(round_no), 0) + 1 into v_round from party_match_board where party_id = p_party_id;
  insert into party_match_board (party_id, round_no, team_a, team_b) values (p_party_id, v_round, v_holder, v_next);
end $$;

-- ---------------------------------------------------------------------------
-- The host decides how long one player may hold the court.
-- ---------------------------------------------------------------------------
create or replace function public.set_party_match_rules(p_party_id uuid, p_win_streak_cap smallint)
returns void language plpgsql security definer set search_path = public as $$
declare v_room party_rooms;
begin
  select * into v_room from party_rooms where id = p_party_id for update;
  if not found or v_room.host_user_id <> auth.uid() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_win_streak_cap is null or p_win_streak_cap < 1 or p_win_streak_cap > 10 then
    raise exception 'INVALID_STREAK_CAP' using errcode = '22023';
  end if;
  update party_rooms set win_streak_cap = p_win_streak_cap, updated_at = now() where id = p_party_id;
  update party_room_board set win_streak_cap = p_win_streak_cap where party_id = p_party_id;
end $$;

-- The board copy has to follow the room, however the room was changed.
create or replace function public.sync_party_room_board_rules() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update party_room_board set win_streak_cap = new.win_streak_cap where party_id = new.id;
  return new;
end $$;

drop trigger if exists party_rooms_sync_board_rules on public.party_rooms;
create trigger party_rooms_sync_board_rules after update of win_streak_cap on public.party_rooms
  for each row execute function public.sync_party_room_board_rules();

-- ---------------------------------------------------------------------------
revoke execute on function public.sync_party_player_stats(uuid) from public, anon, authenticated;
revoke execute on function public.record_party_result(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.sync_party_room_board_rules() from public, anon, authenticated;
revoke execute on function public.pick_singles_challenger(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.pick_team_challenger(uuid, party_team, party_team) from public, anon, authenticated;
revoke execute on function public.set_party_match_rules(uuid, smallint) from public, anon;
grant execute on function public.set_party_match_rules(uuid, smallint) to authenticated;

alter publication supabase_realtime add table public.party_player_stats;

notify pgrst, 'reload schema';
