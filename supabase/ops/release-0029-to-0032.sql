-- ============================================================================
-- รันครั้งเดียวจบ: migration 0029, 0030, 0031, 0032
-- สร้างอัตโนมัติจากไฟล์ใน supabase/migrations/ อย่าแก้ไฟล์นี้ด้วยมือ
-- สร้างใหม่ได้ด้วย: npm run build:release-sql -- 0029 0030 0031 0032
--
-- วิธีใช้: เปิด Supabase -> SQL Editor -> วางทั้งหมด -> Run
--
-- ทั้งหมดอยู่ใน transaction เดียว ถ้ามีบรรทัดไหนพัง ฐานข้อมูลจะคืนสภาพเดิมทั้งหมด
-- เหมือนไม่เคยรัน ไม่มีสภาพค้างครึ่งๆ กลางๆ และแก้แล้วรันซ้ำได้เลย
--
-- ซ้อมก่อนด้วย: npm run rehearse
-- ============================================================================

begin;

-- >>>>>>>>>>>>>>>>>>>>>>  0029_party_matchmaking.sql  <<<<<<<<<<<<<<<<<<<<<<

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
--
-- A win is always worth at least one point and a loss always costs at least one, so a
-- strong player never farms a weak one for free and a game is never worth literally
-- nothing. That floor lives here, in the formula, rather than in the caller: the room
-- shows this number before the game is played (eloDelta in src/lib/party.ts), and the
-- two must agree. scripts/lib/elo-grid.mjs is the table both sides are checked against.
-- ---------------------------------------------------------------------------
create or replace function public.party_elo_delta(p_rating integer, p_opponent integer, p_won boolean)
returns integer language sql immutable as $$
  select case when p_won then greatest(1, v) else least(-1, v) end
  from (
    select round(24 * ((case when p_won then 1.0 else 0.0 end)
                       - 1.0 / (1.0 + power(10.0, (p_opponent - p_rating) / 400.0))))::integer as v
  ) q
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
  v_delta := party_elo_delta(v_win_rating, v_lose_rating, true);

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


-- >>>>>>>>>>>>>>>>>>>>>>  0030_player_leaderboard.sql  <<<<<<<<<<<<<<<<<<<<<<

-- 0030_player_leaderboard.sql
--
-- The shop's ladder, across every ก๊วน night.
--
-- 0029 already keeps a rating per player in player_ratings, but that table is keyed by
-- auth user id, so it can never be read publicly: "Public mirrors intentionally contain
-- no user ids" (0020). This adds the mirror, the same way bookings -> court_occupancy
-- and party_members -> party_member_board already work.
--
-- Two things make that safe to show:
--
--   * A PUBLIC HANDLE. profiles.public_player_id is a fresh uuid that has nothing to do
--     with the auth user id, so the board can say who is first without putting an
--     account id on a page. A player recognises themselves because their own profile row
--     tells them their handle; nobody else can work out whose account a handle belongs to.
--
--   * A WAY OUT. profiles.show_on_leaderboard starts true, so the ladder is not empty on
--     day one, and anyone can take themselves off it from their own page. Taking yourself
--     off deletes the row — it does not merely hide it.
--
-- OWNER'S CALL BEFORE THIS IS RUN (โดม): the board shows a display name and a profile
-- picture to anyone SIGNED IN — not to the public internet, and not to anonymous
-- visitors. Those are the same two fields a ก๊วน room already shows to everyone in it,
-- but a ladder keeps them after the night ends. If you would rather nobody appears until
-- they ask to, change the default on show_on_leaderboard below from true to false; the
-- toggle, the pages and everything else keep working.

-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists public_player_id uuid not null default gen_random_uuid(),
  add column if not exists show_on_leaderboard boolean not null default true;

create unique index if not exists profiles_public_player_id_key
  on public.profiles (public_player_id);

-- The board. No user id, by design.
create table public.player_ranking_board (
  player_key  uuid primary key,
  name        text not null,
  avatar_url  text,
  rating      integer not null,
  played      integer not null,
  wins        integer not null,
  best_streak integer not null,
  updated_at  timestamptz not null default now()
);

create index player_ranking_board_order_idx
  on public.player_ranking_board (rating desc, played desc);

alter table public.player_ranking_board enable row level security;
-- Signed-in players only. A ladder is for the people who play here.
create policy "the ladder is for signed-in players" on public.player_ranking_board
  for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- One place that decides what the board says about one player.
-- ---------------------------------------------------------------------------
create or replace function public.sync_player_ranking_board(p_user_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_profile profiles; v_rating player_ratings;
begin
  select * into v_profile from profiles where id = p_user_id;
  if not found then return; end if;
  select * into v_rating from player_ratings where user_id = p_user_id;

  -- Off the ladder, or has never finished a game: no row at all.
  if not coalesce(v_profile.show_on_leaderboard, true) or v_rating.user_id is null or v_rating.played = 0 then
    delete from player_ranking_board where player_key = v_profile.public_player_id;
    return;
  end if;

  insert into player_ranking_board (player_key, name, avatar_url, rating, played, wins, best_streak, updated_at)
  values (
    v_profile.public_player_id,
    coalesce(nullif(trim(v_profile.display_name), ''), 'ผู้เล่น'),
    v_profile.avatar_url,
    v_rating.rating, v_rating.played, v_rating.wins, v_rating.best_streak, now()
  )
  on conflict (player_key) do update set
    name = excluded.name, avatar_url = excluded.avatar_url,
    rating = excluded.rating, played = excluded.played, wins = excluded.wins,
    best_streak = excluded.best_streak, updated_at = now();
end $$;

create or replace function public.player_ratings_to_board() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform sync_player_ranking_board(new.user_id);
  return new;
end $$;

drop trigger if exists player_ratings_sync_board on public.player_ratings;
create trigger player_ratings_sync_board after insert or update on public.player_ratings
  for each row execute function public.player_ratings_to_board();

create or replace function public.profile_to_ranking_board() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform sync_player_ranking_board(new.id);
  return new;
end $$;

drop trigger if exists profiles_sync_ranking_board on public.profiles;
create trigger profiles_sync_ranking_board
  after update of display_name, avatar_url, show_on_leaderboard on public.profiles
  for each row execute function public.profile_to_ranking_board();

-- Anyone who has already played gets a place.
do $$
declare v_user uuid;
begin
  for v_user in select user_id from player_ratings loop
    perform sync_player_ranking_board(v_user);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- A player's own page: their handle, their place, and whether they are listed.
-- Returns one row even for someone who has never played, so the page can say so.
-- ---------------------------------------------------------------------------
create or replace function public.my_player_card()
returns table (
  player_key uuid, rating integer, played integer, wins integer, losses integer,
  best_streak integer, place integer, listed boolean, total_players integer
) language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_profile profiles; v_rating player_ratings;
begin
  if v_uid is null then raise exception 'LOGIN_REQUIRED' using errcode = '42501'; end if;
  select * into v_profile from profiles where id = v_uid;
  if not found then return; end if;
  select * into v_rating from player_ratings where user_id = v_uid;

  return query
  select
    v_profile.public_player_id,
    coalesce(v_rating.rating, 1000),
    coalesce(v_rating.played, 0),
    coalesce(v_rating.wins, 0),
    coalesce(v_rating.played, 0) - coalesce(v_rating.wins, 0),
    coalesce(v_rating.best_streak, 0),
    -- Place among the people actually on the board; null when not listed or never played.
    (select count(*)::integer + 1 from player_ranking_board b
     where b.rating > coalesce(v_rating.rating, 0)
       and exists (select 1 from player_ranking_board me where me.player_key = v_profile.public_player_id)),
    coalesce(v_profile.show_on_leaderboard, true),
    (select count(*)::integer from player_ranking_board);
end $$;

create or replace function public.set_leaderboard_visibility(p_show boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'LOGIN_REQUIRED' using errcode = '42501'; end if;
  if p_show is null then raise exception 'INVALID_VISIBILITY' using errcode = '22023'; end if;
  update profiles set show_on_leaderboard = p_show where id = auth.uid();
end $$;

-- ---------------------------------------------------------------------------
revoke execute on function public.sync_player_ranking_board(uuid) from public, anon, authenticated;
revoke execute on function public.player_ratings_to_board() from public, anon, authenticated;
revoke execute on function public.profile_to_ranking_board() from public, anon, authenticated;
revoke execute on function public.my_player_card() from public, anon;
grant execute on function public.my_player_card() to authenticated;
revoke execute on function public.set_leaderboard_visibility(boolean) from public, anon;
grant execute on function public.set_leaderboard_visibility(boolean) to authenticated;

alter publication supabase_realtime add table public.player_ranking_board;


-- >>>>>>>>>>>>>>>>>>>>>>  0031_party_rooms_v2.sql  <<<<<<<<<<<<<<<<<<<<<<

-- 0031_party_rooms_v2.sql
--
-- The ก๊วน room grows up: who can get in, who can run it, and whether the night
-- counts towards the shop ladder.
--
-- 1. PUBLIC OR PRIVATE. A public room is listed for everyone to find. A private room is
--    not listed and needs a six-character code to join — the code is what the host
--    shares, by message or as a QR.
--
--    The room id is still enough to OPEN a private room's page, the way an unlisted link
--    works. The gate is on joining, in join_party() below, where the database checks the
--    code. That is deliberate: a policy that hides rows from the public board would have
--    to read party_members from inside a USING clause, where that table's own row
--    security applies and can quietly make the check false. A rule that silently denies
--    is worse than one that is simple and honest about what it protects.
--
-- 2. ROLES. The host can hand the room to someone else, or give out moderator rights, so
--    a night does not stop because one person went to buy water. Everything that used to
--    ask "are you the host" now asks can_manage_party().
--
-- 3. RANKED OR CASUAL. Some people are serious and some are not. A ranked room moves the
--    shop ladder (player_ratings); a casual room never touches it. Both still use the
--    ratings to pick balanced matches, because an even game is better for everyone — a
--    casual room simply does not write the result anywhere permanent.

-- ---------------------------------------------------------------------------
alter table public.party_rooms
  add column if not exists visibility text not null default 'public'
    check (visibility in ('public', 'private')),
  add column if not exists join_code text,
  add column if not exists scoring text not null default 'ranked'
    check (scoring in ('ranked', 'casual'));

create unique index if not exists party_rooms_join_code_key
  on public.party_rooms (join_code) where join_code is not null;

alter table public.party_members
  add column if not exists role text not null default 'player'
    check (role in ('player', 'moderator'));

alter table public.party_room_board
  add column if not exists visibility text not null default 'public',
  add column if not exists scoring text not null default 'ranked';

update public.party_room_board b
set visibility = r.visibility, scoring = r.scoring
from public.party_rooms r where r.id = b.party_id;

-- ---------------------------------------------------------------------------
-- A code people read aloud and type on a phone: no 0/O, no 1/I/L, no vowels, so
-- it cannot be misread and cannot accidentally spell anything.
-- ---------------------------------------------------------------------------
create or replace function public.new_party_join_code() returns text
language plpgsql security definer set search_path = public as $$
declare
  v_alphabet text := '23456789BCDFGHJKMNPQRSTVWXYZ';
  v_code text;
  v_try integer := 0;
begin
  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from party_rooms where join_code = v_code);
    v_try := v_try + 1;
    if v_try > 50 then raise exception 'BUSY_TRY_AGAIN' using errcode = '40001'; end if;
  end loop;
  return v_code;
end $$;

-- ---------------------------------------------------------------------------
-- Who may run this room: the host, or anyone they made a moderator.
-- ---------------------------------------------------------------------------
create or replace function public.can_manage_party(p_party_id uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return false; end if;
  if exists (select 1 from party_rooms where id = p_party_id and host_user_id = v_uid) then
    return true;
  end if;
  return exists (
    select 1 from party_members
    where party_id = p_party_id and user_id = v_uid and status = 'active' and role = 'moderator'
  );
end $$;

create or replace function public.transfer_party_host(p_party_id uuid, p_entry_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_room party_rooms; v_member party_members;
begin
  select * into v_room from party_rooms where id = p_party_id for update;
  -- Only the host hands the room on. A moderator runs the night; they do not own it.
  if not found or v_room.host_user_id <> auth.uid() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select * into v_member from party_members where id = p_entry_id and party_id = p_party_id and status = 'active';
  if not found then raise exception 'PARTY_MEMBER_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_member.user_id = v_room.host_user_id then raise exception 'ALREADY_PARTY_HOST' using errcode = '22023'; end if;

  update party_rooms set host_user_id = v_member.user_id, host_name = v_member.name, updated_at = now()
    where id = p_party_id;
  update party_room_board set host_name = v_member.name where party_id = p_party_id;
  -- The new host needs no moderator flag, and the old host keeps a hand in.
  update party_members set role = 'player' where id = p_entry_id;
  update party_members set role = 'moderator'
    where party_id = p_party_id and user_id = v_room.host_user_id and status = 'active';
end $$;

create or replace function public.set_party_moderator(p_party_id uuid, p_entry_id uuid, p_is_moderator boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_room party_rooms;
begin
  select * into v_room from party_rooms where id = p_party_id for update;
  if not found or v_room.host_user_id <> auth.uid() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_is_moderator is null then raise exception 'INVALID_PARTY_DETAILS' using errcode = '22023'; end if;
  update party_members set role = case when p_is_moderator then 'moderator' else 'player' end
    where id = p_entry_id and party_id = p_party_id and status = 'active'
      and user_id <> v_room.host_user_id;
  if not found then raise exception 'PARTY_MEMBER_NOT_FOUND' using errcode = 'P0002'; end if;
end $$;

-- ---------------------------------------------------------------------------
-- Opening a room now says how it is reached and whether it counts.
-- ---------------------------------------------------------------------------
-- The returned row gains join_code, so the old one has to go first.
drop function if exists public.create_party_booking(smallint, timestamptz, numeric, public.party_mode, text, text);

create or replace function public.create_party_booking(
  p_court_id smallint,
  p_starts_at timestamptz,
  p_hours numeric,
  p_mode public.party_mode,
  p_title text,
  p_host_name text,
  p_visibility text default 'public',
  p_scoring text default 'ranked'
)
returns table (party_id uuid, booking_id uuid, join_code text)
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_booking bookings;
  v_party party_rooms;
  v_title text := clean_party_text(p_title, 60);
  v_name text := clean_party_text(p_host_name, 30);
  v_code text;
begin
  if v_uid is null then raise exception 'LOGIN_REQUIRED' using errcode = '42501'; end if;
  if not can_host_party(v_uid) then raise exception 'PARTY_SUBSCRIPTION_REQUIRED' using errcode = '42501'; end if;
  if v_title is null or v_name is null or p_mode is null then
    raise exception 'INVALID_PARTY_DETAILS' using errcode = '22023';
  end if;
  if coalesce(p_visibility, '') not in ('public', 'private')
     or coalesce(p_scoring, '') not in ('ranked', 'casual') then
    raise exception 'INVALID_PARTY_DETAILS' using errcode = '22023';
  end if;

  if p_visibility = 'private' then v_code := new_party_join_code(); end if;

  select * into v_booking from public.create_booking(p_court_id, p_starts_at, p_hours);
  insert into party_rooms (booking_id, host_user_id, host_name, title, mode, court_id,
                           starts_at, ends_at, visibility, join_code, scoring)
  values (v_booking.id, v_uid, v_name, v_title, p_mode, p_court_id,
          v_booking.starts_at, v_booking.ends_at, p_visibility, v_code, p_scoring)
  returning * into v_party;

  insert into party_members (party_id, user_id, name, slot_no, team)
  values (v_party.id, v_uid, v_name, 1::smallint, 'A'::party_team);

  return query select v_party.id, v_booking.id, v_code;
end $$;

-- ---------------------------------------------------------------------------
-- Joining. A private room asks for its code; a public one does not.
-- The old four-argument version is dropped so PostgREST has one to choose from.
-- ---------------------------------------------------------------------------
drop function if exists public.join_party(uuid, text, smallint, public.party_team);

create or replace function public.join_party(
  p_party_id uuid, p_name text, p_slot_no smallint, p_team public.party_team, p_code text default null
)
returns public.party_members
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_room party_rooms; v_row party_members; v_name text := clean_party_text(p_name, 30);
begin
  if v_uid is null then raise exception 'LOGIN_REQUIRED' using errcode = '42501'; end if;
  select * into v_room from party_rooms where id = p_party_id for update;
  if not found or v_room.status <> 'open' or v_room.ends_at <= now() then raise exception 'PARTY_NOT_OPEN' using errcode = '22023'; end if;
  if v_room.visibility = 'private'
     and not exists (select 1 from party_members where party_id = p_party_id and user_id = v_uid and status = 'active')
     and upper(coalesce(trim(p_code), '')) <> coalesce(v_room.join_code, '') then
    raise exception 'WRONG_PARTY_CODE' using errcode = '42501';
  end if;
  if v_name is null or p_team is null or p_slot_no is null or p_slot_no > v_room.capacity
     or not party_team_slot_valid(p_team, p_slot_no) then
    raise exception 'INVALID_PARTY_DETAILS' using errcode = '22023';
  end if;
  if (select count(*) from party_members where party_id = p_party_id and status = 'active') >= v_room.capacity then
    raise exception 'PARTY_FULL' using errcode = '22023';
  end if;
  begin
    insert into party_members (party_id, user_id, name, slot_no, team)
    values (p_party_id, v_uid, v_name, p_slot_no, p_team) returning * into v_row;
  exception when unique_violation then
    if exists (select 1 from party_members where party_id = p_party_id and user_id = v_uid and status = 'active') then
      raise exception 'ALREADY_IN_PARTY' using errcode = '23505';
    end if;
    raise exception 'PARTY_SLOT_TAKEN' using errcode = '23505';
  end;
  return v_row;
end $$;

-- What a code opens, before committing to a slot. Works without the board, so a
-- private room can be previewed by someone who was given the code.
create or replace function public.find_party_by_code(p_code text)
returns table (
  party_id uuid, title text, host_name text, mode public.party_mode, scoring text,
  court_id smallint, starts_at timestamptz, ends_at timestamptz, capacity smallint, members integer
) language plpgsql stable security definer set search_path = public as $$
declare v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
begin
  if char_length(v_code) <> 6 then raise exception 'WRONG_PARTY_CODE' using errcode = '42501'; end if;
  return query
  select r.id, r.title, r.host_name, r.mode, r.scoring, r.court_id, r.starts_at, r.ends_at, r.capacity,
         (select count(*)::integer from party_members m where m.party_id = r.id and m.status = 'active')
  from party_rooms r
  where r.join_code = v_code and r.status = 'open' and r.ends_at > now();
  if not found then raise exception 'WRONG_PARTY_CODE' using errcode = '42501'; end if;
end $$;

-- "Surprise me": drop into a public room of the kind asked for that still has space.
create or replace function public.auto_join_party(p_mode public.party_mode, p_scoring text, p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_room party_rooms; v_slot smallint; v_name text := clean_party_text(p_name, 30);
begin
  if v_uid is null then raise exception 'LOGIN_REQUIRED' using errcode = '42501'; end if;
  if v_name is null then raise exception 'INVALID_NAME' using errcode = '22023'; end if;
  if exists (select 1 from party_members m join party_rooms r on r.id = m.party_id
             where m.user_id = v_uid and m.status = 'active' and r.status = 'open' and r.ends_at > now()) then
    raise exception 'ALREADY_IN_PARTY' using errcode = '23505';
  end if;

  -- The emptiest room first, so a night does not end up with one full room and three
  -- rooms of two people; random only breaks ties.
  select r.* into v_room from party_rooms r
  where r.status = 'open' and r.ends_at > now() and r.visibility = 'public'
    and r.mode = p_mode and (p_scoring is null or r.scoring = p_scoring)
    and (select count(*) from party_members m where m.party_id = r.id and m.status = 'active') < r.capacity
  order by (select count(*) from party_members m where m.party_id = r.id and m.status = 'active') desc,
           r.starts_at, random()
  limit 1 for update;
  if not found then raise exception 'NO_PARTY_TO_JOIN' using errcode = 'P0002'; end if;

  select s.n into v_slot from generate_series(1, v_room.capacity) as s(n)
  where not exists (select 1 from party_members m
                    where m.party_id = v_room.id and m.slot_no = s.n and m.status = 'active')
  order by s.n limit 1;
  if v_slot is null then raise exception 'PARTY_FULL' using errcode = '22023'; end if;

  insert into party_members (party_id, user_id, name, slot_no, team)
  values (v_room.id, v_uid, v_name,
          v_slot, (array['A','B','C','D','E','F'])[((v_slot - 1) / 2) + 1]::party_team);
  return v_room.id;
end $$;

-- ---------------------------------------------------------------------------
-- A casual room never writes to the shop ladder. It still keeps the night's
-- score, and the matchmaker still uses ratings so the games stay even.
-- ---------------------------------------------------------------------------
create or replace function public.record_party_result(
  p_party_id uuid, p_winner_entry uuid, p_loser_entry uuid
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_win_rating integer; v_lose_rating integer; v_delta integer;
  v_winner_user uuid; v_loser_user uuid; v_ranked boolean;
begin
  select scoring = 'ranked' into v_ranked from party_rooms where id = p_party_id;
  select rating into v_win_rating from party_player_stats where party_id = p_party_id and entry_id = p_winner_entry;
  select rating into v_lose_rating from party_player_stats where party_id = p_party_id and entry_id = p_loser_entry;
  if v_win_rating is null or v_lose_rating is null then return; end if;

  v_delta := party_elo_delta(v_win_rating, v_lose_rating, true);

  update party_player_stats
  set rating = rating + v_delta, rating_delta = rating_delta + v_delta,
      played = played + 1, wins = wins + 1,
      streak = streak + 1, best_streak = greatest(best_streak, streak + 1)
  where party_id = p_party_id and entry_id = p_winner_entry;

  update party_player_stats
  set rating = greatest(100, rating - v_delta), rating_delta = rating_delta - v_delta,
      played = played + 1, losses = losses + 1, streak = 0
  where party_id = p_party_id and entry_id = p_loser_entry;

  if not coalesce(v_ranked, true) then return; end if;

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
-- Running the room is now "can manage", not "is the host".
-- ---------------------------------------------------------------------------
create or replace function public.advance_singles_match(p_party_id uuid, p_winner_entry uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_room party_rooms; v_current party_singles_match_board;
  v_holder uuid; v_avoid uuid; v_next uuid; v_loser uuid;
  v_streak integer; v_round integer; v_holder_name text; v_next_name text;
begin
  select * into v_room from party_rooms where id = p_party_id for update;
  if not found or not can_manage_party(p_party_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
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
      update party_singles_queue set state = 'waiting', queued_at = now()
        where party_id = p_party_id and entry_id = p_winner_entry;
      update party_player_stats set streak = 0
        where party_id = p_party_id and entry_id = p_winner_entry;
      v_holder := null;
    else
      update party_singles_queue set state = 'playing'
        where party_id = p_party_id and entry_id = p_winner_entry;
      v_holder := p_winner_entry; v_avoid := v_loser;
    end if;
  else
    if p_winner_entry is not null then raise exception 'NO_ACTIVE_PARTY_MATCH' using errcode = '22023'; end if;
    select entry_id into v_holder from party_singles_queue
      where party_id = p_party_id and state = 'playing' limit 1 for update;
  end if;

  if v_holder is null then
    v_holder := pick_singles_challenger(p_party_id, null, null);
    if v_holder is null then raise exception 'NOT_ENOUGH_READY_PLAYERS' using errcode = '22023'; end if;
  end if;

  v_next := pick_singles_challenger(p_party_id, v_holder, v_avoid);
  if v_next is null then
    update party_singles_queue set state = 'playing' where party_id = p_party_id and entry_id = v_holder;
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

create or replace function public.advance_party_match(p_party_id uuid, p_winner public.party_team default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_room party_rooms; v_current party_match_board;
  v_holder party_team; v_avoid party_team; v_next party_team; v_loser party_team;
  v_streak integer; v_round integer; v_win_member record; v_lose_member record;
begin
  select * into v_room from party_rooms where id = p_party_id for update;
  if not found or not can_manage_party(p_party_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
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

    for v_win_member in
      select m.id from party_members m where m.party_id = p_party_id and m.team = p_winner and m.status = 'active'
    loop
      for v_lose_member in
        select m.id from party_members m where m.party_id = p_party_id and m.team = v_loser and m.status = 'active'
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
      v_holder := p_winner; v_avoid := v_loser;
    end if;
  else
    if p_winner is not null then raise exception 'NO_ACTIVE_PARTY_MATCH' using errcode = '22023'; end if;
    select team into v_holder from party_team_queue where party_id = p_party_id and state = 'playing' limit 1 for update;
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

create or replace function public.set_party_match_rules(p_party_id uuid, p_win_streak_cap smallint)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not can_manage_party(p_party_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_win_streak_cap is null or p_win_streak_cap < 1 or p_win_streak_cap > 10 then
    raise exception 'INVALID_STREAK_CAP' using errcode = '22023';
  end if;
  update party_rooms set win_streak_cap = p_win_streak_cap, updated_at = now() where id = p_party_id;
  update party_room_board set win_streak_cap = p_win_streak_cap where party_id = p_party_id;
end $$;

create or replace function public.kick_party_member(p_party_id uuid, p_entry_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_host uuid;
begin
  if not can_manage_party(p_party_id) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  select host_user_id into v_host from party_rooms where id = p_party_id;
  -- Nobody removes the host, and a moderator cannot remove another moderator.
  update party_members set status = 'kicked', left_at = now()
  where id = p_entry_id and party_id = p_party_id and status = 'active'
    and user_id <> v_host
    and (role = 'player' or v_host = auth.uid());
  if not found then raise exception 'PARTY_MEMBER_NOT_FOUND' using errcode = 'P0002'; end if;
end $$;

-- The room page needs to know what the viewer may do, so this returns more columns.
drop function if exists public.my_party_entries();

create or replace function public.my_party_entries()
returns table (entry_id uuid, party_id uuid, slot_no smallint, is_host boolean, can_manage boolean, role text)
language sql stable security definer set search_path = public as $$
  select m.id, m.party_id, m.slot_no, r.host_user_id = auth.uid(),
         r.host_user_id = auth.uid() or m.role = 'moderator', m.role
  from party_members m join party_rooms r on r.id = m.party_id
  where m.user_id = auth.uid() and m.status = 'active' and r.status in ('pending_payment', 'open')
$$;

-- The code is not on the public board, and party_rooms is not readable directly, so a
-- member asks for their own room's code through here.
create or replace function public.my_party_join_code(p_party_id uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare v_code text;
begin
  select r.join_code into v_code from party_rooms r
  where r.id = p_party_id
    and exists (select 1 from party_members m
                where m.party_id = r.id and m.user_id = auth.uid() and m.status = 'active');
  return v_code;
end $$;

-- Keep the public board's new columns in step with the room.
create or replace function public.sync_party_public_board() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_room party_rooms;
begin
  v_room := case when tg_op = 'DELETE' then old else new end;
  if tg_op <> 'DELETE' and v_room.status = 'open' and v_room.ends_at > now() then
    insert into party_room_board (party_id, host_name, title, mode, capacity, court_id, starts_at, ends_at,
                                  win_streak_cap, visibility, scoring)
    values (v_room.id, v_room.host_name, v_room.title, v_room.mode, v_room.capacity, v_room.court_id,
            v_room.starts_at, v_room.ends_at, v_room.win_streak_cap, v_room.visibility, v_room.scoring)
    on conflict (party_id) do update set
      host_name = excluded.host_name, title = excluded.title, mode = excluded.mode,
      capacity = excluded.capacity, court_id = excluded.court_id,
      starts_at = excluded.starts_at, ends_at = excluded.ends_at,
      win_streak_cap = excluded.win_streak_cap, visibility = excluded.visibility, scoring = excluded.scoring;

    insert into party_member_board (entry_id, party_id, name, slot_no, joined_at)
    select id, party_id, name, slot_no, joined_at from party_members
    where party_id = v_room.id and status = 'active'
    on conflict (entry_id) do update set name = excluded.name, slot_no = excluded.slot_no;
  else
    delete from party_member_board where party_id = v_room.id;
    delete from party_room_board where party_id = v_room.id;
  end if;
  return coalesce(new, old);
end $$;

-- ---------------------------------------------------------------------------
revoke execute on function public.new_party_join_code() from public, anon, authenticated;
revoke execute on function public.can_manage_party(uuid) from public, anon;
grant execute on function public.can_manage_party(uuid) to authenticated;
revoke execute on function public.create_party_booking(smallint, timestamptz, numeric, party_mode, text, text, text, text) from public, anon;
grant execute on function public.create_party_booking(smallint, timestamptz, numeric, party_mode, text, text, text, text) to authenticated;
revoke execute on function public.join_party(uuid, text, smallint, party_team, text) from public, anon;
grant execute on function public.join_party(uuid, text, smallint, party_team, text) to authenticated;
revoke execute on function public.find_party_by_code(text) from public, anon;
grant execute on function public.find_party_by_code(text) to authenticated;
revoke execute on function public.auto_join_party(party_mode, text, text) from public, anon;
grant execute on function public.auto_join_party(party_mode, text, text) to authenticated;
revoke execute on function public.transfer_party_host(uuid, uuid) from public, anon;
grant execute on function public.transfer_party_host(uuid, uuid) to authenticated;
revoke execute on function public.set_party_moderator(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_party_moderator(uuid, uuid, boolean) to authenticated;
revoke execute on function public.my_party_join_code(uuid) from public, anon;
grant execute on function public.my_party_join_code(uuid) to authenticated;
revoke execute on function public.my_party_entries() from public, anon;
grant execute on function public.my_party_entries() to authenticated;


-- >>>>>>>>>>>>>>>>>>>>>>  0032_community.sql  <<<<<<<<<<<<<<<<<<<<<<

-- 0032_community.sql
--
-- A place to share how the night went — with the tools to look after it built in from
-- the first day, not bolted on after the first problem.
--
-- This runs on a site where customers pay real money, so the parts that usually get
-- added later are here now:
--
--   * NOTHING IS EVER REALLY DELETED. A post the author removes, or an admin hides, keeps
--     its row and its text with a status and a reason. The public mirror drops it
--     immediately, so it is gone from every screen, but the shop can still see what was
--     said if someone asks. Hiding is reversible; the audit trail is not editable.
--
--   * EVERY PIECE OF CONTENT CAN BE REPORTED, by anyone signed in, and every report lands
--     in one queue an admin works through at /admin/community.
--
--   * RATE LIMITS IN THE DATABASE, like bookings and the play queue already have, so one
--     account cannot flood the feed faster than a person can be asked to stop.
--
--   * NO USER IDS ON THE PUBLIC BOARDS. The feed shows the same public_player_id handle
--     the ladder uses (0030), never an account id.
--
-- OWNER'S NOTE (โดม): a photo posted here is visible to anyone signed in, and there is no
-- automatic check on what is in it. Somebody has to read the report queue. If nobody can
-- watch it on a given week, set community_settings.posting_open to false and the feed
-- becomes read-only until it is turned back on — no deploy needed.

-- ---------------------------------------------------------------------------
create table public.community_settings (
  id            smallint primary key default 1 check (id = 1),
  posting_open  boolean not null default true,
  updated_at    timestamptz not null default now()
);
insert into public.community_settings (id) values (1) on conflict (id) do nothing;

alter table public.community_settings enable row level security;
create policy "community settings are public" on public.community_settings
  for select to anon, authenticated using (true);

create type public.community_status as enum ('visible', 'hidden', 'removed');

create table public.community_posts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  party_id    uuid references public.party_rooms on delete set null,
  body        text not null check (char_length(btrim(body)) between 1 and 2000),
  image_path  text,
  status      public.community_status not null default 'visible',
  status_note text,
  likes       integer not null default 0,
  comments    integer not null default 0,
  created_at  timestamptz not null default now(),
  edited_at   timestamptz
);

create table public.community_comments (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references public.community_posts on delete cascade,
  user_id     uuid not null references auth.users on delete cascade,
  body        text not null check (char_length(btrim(body)) between 1 and 500),
  status      public.community_status not null default 'visible',
  status_note text,
  created_at  timestamptz not null default now()
);

create table public.community_likes (
  post_id    uuid not null references public.community_posts on delete cascade,
  user_id    uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table public.community_reports (
  id           uuid primary key default gen_random_uuid(),
  target_type  text not null check (target_type in ('post', 'comment')),
  target_id    uuid not null,
  reporter_id  uuid not null references auth.users on delete cascade,
  reason       text not null check (char_length(btrim(reason)) between 1 and 300),
  status       text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  created_at   timestamptz not null default now(),
  handled_by   uuid references auth.users,
  handled_at   timestamptz,
  -- One report per person per thing, so a queue cannot be padded by one account.
  unique (target_type, target_id, reporter_id)
);

create index community_posts_recent_idx on public.community_posts (status, created_at desc);
create index community_comments_post_idx on public.community_comments (post_id, status, created_at);
create index community_reports_open_idx on public.community_reports (status, created_at desc);

-- ---------------------------------------------------------------------------
-- The public side. No user id: the author is the same handle the ladder shows.
-- ---------------------------------------------------------------------------
create table public.community_feed (
  post_id     uuid primary key references public.community_posts on delete cascade,
  author_key  uuid not null,
  author_name text not null,
  avatar_url  text,
  body        text not null,
  image_path  text,
  party_title text,
  likes       integer not null default 0,
  comments    integer not null default 0,
  created_at  timestamptz not null,
  edited_at   timestamptz
);

create table public.community_comment_board (
  comment_id  uuid primary key references public.community_comments on delete cascade,
  post_id     uuid not null references public.community_posts on delete cascade,
  author_key  uuid not null,
  author_name text not null,
  avatar_url  text,
  body        text not null,
  created_at  timestamptz not null
);

create index community_feed_recent_idx on public.community_feed (created_at desc);
create index community_comment_board_post_idx on public.community_comment_board (post_id, created_at);

alter table public.community_posts enable row level security;
alter table public.community_comments enable row level security;
alter table public.community_likes enable row level security;
alter table public.community_reports enable row level security;
alter table public.community_feed enable row level security;
alter table public.community_comment_board enable row level security;

-- The feed is for people who play here, like the ladder.
create policy "the feed is for signed-in players" on public.community_feed
  for select to authenticated using (true);
create policy "comments are for signed-in players" on public.community_comment_board
  for select to authenticated using (true);
create policy "a player reads their own posts" on public.community_posts
  for select to authenticated using (user_id = auth.uid() or is_admin());
create policy "a player reads their own comments" on public.community_comments
  for select to authenticated using (user_id = auth.uid() or is_admin());
create policy "a player sees their own likes" on public.community_likes
  for select to authenticated using (user_id = auth.uid());
-- Reports are an admin queue. A reporter is not shown other people's reports.
create policy "reports are read by admins" on public.community_reports
  for select to authenticated using (is_admin() or reporter_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Mirrors follow the private tables, and only ever carry what is visible.
-- ---------------------------------------------------------------------------
create or replace function public.sync_community_post(p_post_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_post community_posts; v_profile profiles; v_party text;
begin
  select * into v_post from community_posts where id = p_post_id;
  if not found or v_post.status <> 'visible' then
    delete from community_feed where post_id = p_post_id;
    return;
  end if;
  select * into v_profile from profiles where id = v_post.user_id;
  select title into v_party from party_rooms where id = v_post.party_id;

  insert into community_feed (post_id, author_key, author_name, avatar_url, body, image_path,
                              party_title, likes, comments, created_at, edited_at)
  values (v_post.id, v_profile.public_player_id,
          coalesce(nullif(btrim(v_profile.display_name), ''), 'ผู้เล่น'), v_profile.avatar_url,
          v_post.body, v_post.image_path, v_party, v_post.likes, v_post.comments,
          v_post.created_at, v_post.edited_at)
  on conflict (post_id) do update set
    author_name = excluded.author_name, avatar_url = excluded.avatar_url,
    body = excluded.body, image_path = excluded.image_path, party_title = excluded.party_title,
    likes = excluded.likes, comments = excluded.comments, edited_at = excluded.edited_at;
end $$;

create or replace function public.sync_community_comment(p_comment_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_comment community_comments; v_profile profiles;
begin
  select * into v_comment from community_comments where id = p_comment_id;
  if not found or v_comment.status <> 'visible' then
    delete from community_comment_board where comment_id = p_comment_id;
    return;
  end if;
  select * into v_profile from profiles where id = v_comment.user_id;
  insert into community_comment_board (comment_id, post_id, author_key, author_name, avatar_url, body, created_at)
  values (v_comment.id, v_comment.post_id, v_profile.public_player_id,
          coalesce(nullif(btrim(v_profile.display_name), ''), 'ผู้เล่น'), v_profile.avatar_url,
          v_comment.body, v_comment.created_at)
  on conflict (comment_id) do update set
    author_name = excluded.author_name, avatar_url = excluded.avatar_url, body = excluded.body;
end $$;

create or replace function public.community_post_changed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform sync_community_post(case when tg_op = 'DELETE' then old.id else new.id end);
  return coalesce(new, old);
end $$;

create or replace function public.community_comment_changed() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_post uuid := case when tg_op = 'DELETE' then old.post_id else new.post_id end;
begin
  perform sync_community_comment(case when tg_op = 'DELETE' then old.id else new.id end);
  update community_posts set comments =
    (select count(*) from community_comments c where c.post_id = v_post and c.status = 'visible')
    where id = v_post;
  perform sync_community_post(v_post);
  return coalesce(new, old);
end $$;

create or replace function public.community_like_changed() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_post uuid := case when tg_op = 'DELETE' then old.post_id else new.post_id end;
begin
  update community_posts set likes = (select count(*) from community_likes l where l.post_id = v_post)
    where id = v_post;
  perform sync_community_post(v_post);
  return coalesce(new, old);
end $$;

create trigger community_posts_sync after insert or update or delete on public.community_posts
  for each row execute function public.community_post_changed();
create trigger community_comments_sync after insert or update or delete on public.community_comments
  for each row execute function public.community_comment_changed();
create trigger community_likes_sync after insert or delete on public.community_likes
  for each row execute function public.community_like_changed();

-- A name or picture change follows into everything that person has written.
create or replace function public.community_profile_changed() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  for v_id in select id from community_posts where user_id = new.id and status = 'visible' loop
    perform sync_community_post(v_id);
  end loop;
  for v_id in select id from community_comments where user_id = new.id and status = 'visible' loop
    perform sync_community_comment(v_id);
  end loop;
  return new;
end $$;

create trigger profiles_sync_community after update of display_name, avatar_url on public.profiles
  for each row execute function public.community_profile_changed();

-- ---------------------------------------------------------------------------
-- Writing. Rate limits sit here, where they cannot be skipped by calling the API
-- directly, exactly as create_booking() and join_queue() already do it.
-- ---------------------------------------------------------------------------
create or replace function public.create_community_post(p_body text, p_party_id uuid default null, p_image_path text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare c_max_per_hour constant integer := 10; v_uid uuid := auth.uid(); v_body text := btrim(coalesce(p_body, '')); v_id uuid;
begin
  if v_uid is null then raise exception 'LOGIN_REQUIRED' using errcode = '42501'; end if;
  if not (select posting_open from community_settings where id = 1) then
    raise exception 'COMMUNITY_CLOSED' using errcode = '42501';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 2000 then
    raise exception 'INVALID_POST' using errcode = '22023';
  end if;
  if p_image_path is not null and p_image_path !~ ('^' || v_uid::text || '/') then
    raise exception 'INVALID_POST' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 1));
  if (select count(*) from community_posts
      where user_id = v_uid and created_at > now() - interval '1 hour') >= c_max_per_hour then
    raise exception 'TOO_MANY_POSTS' using errcode = '22023';
  end if;

  insert into community_posts (user_id, party_id, body, image_path)
  values (v_uid, p_party_id, v_body, p_image_path) returning id into v_id;
  return v_id;
end $$;

create or replace function public.edit_community_post(p_post_id uuid, p_body text)
returns void language plpgsql security definer set search_path = public as $$
declare v_body text := btrim(coalesce(p_body, ''));
begin
  if char_length(v_body) < 1 or char_length(v_body) > 2000 then
    raise exception 'INVALID_POST' using errcode = '22023';
  end if;
  update community_posts set body = v_body, edited_at = now()
    where id = p_post_id and user_id = auth.uid() and status = 'visible';
  if not found then raise exception 'POST_NOT_FOUND' using errcode = 'P0002'; end if;
end $$;

-- The author takes it down. The row and its text stay, so a complaint about something
-- that was deleted in a hurry can still be looked into.
create or replace function public.delete_community_post(p_post_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update community_posts set status = 'removed', status_note = 'author'
    where id = p_post_id and user_id = auth.uid() and status = 'visible';
  if not found then raise exception 'POST_NOT_FOUND' using errcode = 'P0002'; end if;
end $$;

create or replace function public.add_community_comment(p_post_id uuid, p_body text)
returns uuid language plpgsql security definer set search_path = public as $$
declare c_max_per_hour constant integer := 30; v_uid uuid := auth.uid(); v_body text := btrim(coalesce(p_body, '')); v_id uuid;
begin
  if v_uid is null then raise exception 'LOGIN_REQUIRED' using errcode = '42501'; end if;
  if not (select posting_open from community_settings where id = 1) then
    raise exception 'COMMUNITY_CLOSED' using errcode = '42501';
  end if;
  if char_length(v_body) < 1 or char_length(v_body) > 500 then
    raise exception 'INVALID_POST' using errcode = '22023';
  end if;
  if not exists (select 1 from community_posts where id = p_post_id and status = 'visible') then
    raise exception 'POST_NOT_FOUND' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 2));
  if (select count(*) from community_comments
      where user_id = v_uid and created_at > now() - interval '1 hour') >= c_max_per_hour then
    raise exception 'TOO_MANY_POSTS' using errcode = '22023';
  end if;

  insert into community_comments (post_id, user_id, body) values (p_post_id, v_uid, v_body) returning id into v_id;
  return v_id;
end $$;

create or replace function public.delete_community_comment(p_comment_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update community_comments set status = 'removed', status_note = 'author'
    where id = p_comment_id and user_id = auth.uid() and status = 'visible';
  if not found then raise exception 'POST_NOT_FOUND' using errcode = 'P0002'; end if;
end $$;

create or replace function public.toggle_community_like(p_post_id uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'LOGIN_REQUIRED' using errcode = '42501'; end if;
  if exists (select 1 from community_likes where post_id = p_post_id and user_id = v_uid) then
    delete from community_likes where post_id = p_post_id and user_id = v_uid;
    return false;
  end if;
  if not exists (select 1 from community_posts where id = p_post_id and status = 'visible') then
    raise exception 'POST_NOT_FOUND' using errcode = 'P0002';
  end if;
  insert into community_likes (post_id, user_id) values (p_post_id, v_uid);
  return true;
end $$;

-- ---------------------------------------------------------------------------
-- Reporting and moderation.
-- ---------------------------------------------------------------------------
create or replace function public.report_community_content(p_target_type text, p_target_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare c_max_per_hour constant integer := 20; v_uid uuid := auth.uid(); v_reason text := btrim(coalesce(p_reason, ''));
begin
  if v_uid is null then raise exception 'LOGIN_REQUIRED' using errcode = '42501'; end if;
  if p_target_type not in ('post', 'comment') or char_length(v_reason) < 1 or char_length(v_reason) > 300 then
    raise exception 'INVALID_REPORT' using errcode = '22023';
  end if;
  if (p_target_type = 'post' and not exists (select 1 from community_posts where id = p_target_id))
     or (p_target_type = 'comment' and not exists (select 1 from community_comments where id = p_target_id)) then
    raise exception 'POST_NOT_FOUND' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 3));
  if (select count(*) from community_reports
      where reporter_id = v_uid and created_at > now() - interval '1 hour') >= c_max_per_hour then
    raise exception 'TOO_MANY_POSTS' using errcode = '22023';
  end if;

  insert into community_reports (target_type, target_id, reporter_id, reason)
  values (p_target_type, p_target_id, v_uid, v_reason)
  on conflict (target_type, target_id, reporter_id) do update set reason = excluded.reason, created_at = now();
end $$;

-- An admin hides something, or puts it back. Hiding removes it from every screen at once
-- because the mirror drops the row; the text itself is kept with who did it and why.
create or replace function public.moderate_community_content(
  p_target_type text, p_target_id uuid, p_action text, p_note text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_note text := left(btrim(coalesce(p_note, '')), 300);
begin
  if not is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_target_type not in ('post', 'comment') or p_action not in ('hide', 'restore', 'dismiss') then
    raise exception 'INVALID_REPORT' using errcode = '22023';
  end if;

  if p_action = 'hide' then
    if p_target_type = 'post' then
      update community_posts set status = 'hidden', status_note = v_note where id = p_target_id;
    else
      update community_comments set status = 'hidden', status_note = v_note where id = p_target_id;
    end if;
  elsif p_action = 'restore' then
    if p_target_type = 'post' then
      update community_posts set status = 'visible', status_note = v_note
        where id = p_target_id and status = 'hidden';
    else
      update community_comments set status = 'visible', status_note = v_note
        where id = p_target_id and status = 'hidden';
    end if;
  end if;

  update community_reports
  set status = case when p_action = 'dismiss' then 'dismissed' else 'actioned' end,
      handled_by = auth.uid(), handled_at = now()
  where target_type = p_target_type and target_id = p_target_id and status = 'open';
end $$;

create or replace function public.set_community_posting(p_open boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_open is null then raise exception 'INVALID_REPORT' using errcode = '22023'; end if;
  update community_settings set posting_open = p_open, updated_at = now() where id = 1;
end $$;

-- What the admin queue shows: every open report with the text it is about.
create or replace function public.open_community_reports()
returns table (
  report_id uuid, target_type text, target_id uuid, reason text, created_at timestamptz,
  reports integer, body text, author_name text, content_status public.community_status
) language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  return query
  select r.id, r.target_type, r.target_id, r.reason, r.created_at,
         (select count(*)::integer from community_reports o
          where o.target_type = r.target_type and o.target_id = r.target_id and o.status = 'open'),
         coalesce(p.body, c.body),
         coalesce(nullif(btrim(pr.display_name), ''), 'ผู้เล่น'),
         coalesce(p.status, c.status)
  from community_reports r
  left join community_posts p on r.target_type = 'post' and p.id = r.target_id
  left join community_comments c on r.target_type = 'comment' and c.id = r.target_id
  left join profiles pr on pr.id = coalesce(p.user_id, c.user_id)
  where r.status = 'open'
  order by r.created_at;
end $$;

/** Which posts the signed-in player has liked, so the feed can fill in the hearts. */
create or replace function public.my_community_likes()
returns table (post_id uuid) language sql stable security definer set search_path = public as $$
  select post_id from community_likes where user_id = auth.uid()
$$;

-- ---------------------------------------------------------------------------
-- Photos. One per post, in its own bucket, written only under your own folder.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('community', 'community', true, 4194304, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "upload own community photo" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'community' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "remove own community photo" on storage.objects
  for delete to authenticated
  using (bucket_id = 'community' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- ---------------------------------------------------------------------------
revoke execute on function public.sync_community_post(uuid) from public, anon, authenticated;
revoke execute on function public.sync_community_comment(uuid) from public, anon, authenticated;
revoke execute on function public.community_post_changed() from public, anon, authenticated;
revoke execute on function public.community_comment_changed() from public, anon, authenticated;
revoke execute on function public.community_like_changed() from public, anon, authenticated;
revoke execute on function public.community_profile_changed() from public, anon, authenticated;
revoke execute on function public.create_community_post(text, uuid, text) from public, anon;
grant execute on function public.create_community_post(text, uuid, text) to authenticated;
revoke execute on function public.edit_community_post(uuid, text) from public, anon;
grant execute on function public.edit_community_post(uuid, text) to authenticated;
revoke execute on function public.delete_community_post(uuid) from public, anon;
grant execute on function public.delete_community_post(uuid) to authenticated;
revoke execute on function public.add_community_comment(uuid, text) from public, anon;
grant execute on function public.add_community_comment(uuid, text) to authenticated;
revoke execute on function public.delete_community_comment(uuid) from public, anon;
grant execute on function public.delete_community_comment(uuid) to authenticated;
revoke execute on function public.toggle_community_like(uuid) from public, anon;
grant execute on function public.toggle_community_like(uuid) to authenticated;
revoke execute on function public.report_community_content(text, uuid, text) from public, anon;
grant execute on function public.report_community_content(text, uuid, text) to authenticated;
revoke execute on function public.moderate_community_content(text, uuid, text, text) from public, anon;
grant execute on function public.moderate_community_content(text, uuid, text, text) to authenticated;
revoke execute on function public.set_community_posting(boolean) from public, anon;
grant execute on function public.set_community_posting(boolean) to authenticated;
revoke execute on function public.open_community_reports() from public, anon;
grant execute on function public.open_community_reports() to authenticated;
revoke execute on function public.my_community_likes() from public, anon;
grant execute on function public.my_community_likes() to authenticated;

alter publication supabase_realtime add table public.community_feed, public.community_comment_board;

commit;

-- บอก API ให้โหลดโครงสร้างใหม่ (ต้องอยู่นอก transaction)
notify pgrst, 'reload schema';
