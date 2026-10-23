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

notify pgrst, 'reload schema';
