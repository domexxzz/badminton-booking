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

notify pgrst, 'reload schema';
