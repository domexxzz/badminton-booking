-- 0033_guilds.sql
--
-- Guilds: a ก๊วน that lasts longer than one night. Design and the owner's questions:
-- docs/design/2026-10-25-guilds.md.
--
-- A guild has a name, a short tag, an emblem, members with roles, and XP that comes only
-- from playing at the shop. XP adds up to a level, each calendar month is a season with a
-- ranking, and the top three of a season keep a badge.
--
-- What this deliberately does NOT touch:
--
--   * MONEY. Nothing here reads or writes a price, a payment or a refund. Court time
--     counts for XP only once the booking is confirmed (and, for pay-later, paid), and
--     that check is a yes/no — no amount is ever used.
--
--   * THE BOOKING AND PARTY RULES. Guild XP hangs off the existing match boards with
--     triggers that swallow their own errors, so a fault in guild code can never stop a
--     match from being recorded. The only change to an existing table is a nullable
--     party_rooms.guild_id, set through tag_party_with_guild().
--
--   * USER IDS ON PUBLIC BOARDS. guild_board and guild_member_board follow 0020/0030:
--     a member is shown by public_player_id, and someone who took themselves off the
--     ladder is shown as an unnamed member with no handle at all.
--
-- Defaults the owner can still change (โดม) — each is one constant in this file:
--   one guild per player · 30 members · anyone signed in may create one ·
--   monthly seasons · guild pages for signed-in players only.

-- ---------------------------------------------------------------------------
-- Settings, the style list, and the level rule.
-- ---------------------------------------------------------------------------
create table public.guild_settings (
  id             smallint primary key default 1 check (id = 1),
  creation_open  boolean not null default true,
  updated_at     timestamptz not null default now()
);
insert into public.guild_settings (id) values (1) on conflict (id) do nothing;

alter table public.guild_settings enable row level security;
create policy "guild settings are public" on public.guild_settings
  for select to anon, authenticated using (true);

-- Kept in step with scripts/lib/guild-rules.mjs by scripts/test-db.mjs.
create or replace function public.guild_style_options()
returns table (emblems text[], colors text[]) language sql immutable as $$
  select
    array['shuttle', 'racket', 'crown', 'fire', 'bolt', 'star', 'shield', 'dragon', 'tiger', 'eagle', 'wave', 'leaf'],
    array['#0f766e', '#2563eb', '#7c3aed', '#db2777', '#dc2626', '#ea580c', '#ca8a04', '#334155']
$$;

-- Level n needs 100 × n × (n − 1) XP in total. Same rule as src/lib/guilds/rules.ts.
create or replace function public.guild_level(p_xp integer) returns integer
language plpgsql immutable as $$
declare v_xp bigint := greatest(0, coalesce(p_xp, 0)); v_level bigint;
begin
  v_level := floor((1 + sqrt(1 + v_xp / 25.0)) / 2);
  if 100 * (v_level + 1) * v_level <= v_xp then v_level := v_level + 1; end if;
  if 100 * v_level * (v_level - 1) > v_xp then v_level := v_level - 1; end if;
  return greatest(1, v_level);
end $$;

-- ---------------------------------------------------------------------------
-- The private tables.
-- ---------------------------------------------------------------------------
create type public.guild_role as enum ('leader', 'officer', 'member');
create type public.guild_status as enum ('active', 'hidden', 'disbanded');

create table public.guilds (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (char_length(name) between 3 and 24),
  name_key     text not null,
  tag          text not null check (tag ~ '^[A-Z0-9ก-๙]{2,4}$'),
  emblem       text not null,
  color        text not null,
  description  text check (char_length(description) <= 200),
  join_policy  text not null default 'approval' check (join_policy in ('open', 'approval', 'code')),
  join_code    text not null,
  status       public.guild_status not null default 'active',
  status_note  text,
  created_by   uuid references auth.users on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
-- A disbanded guild frees its name and tag.
create unique index guilds_name_key on public.guilds (name_key) where status <> 'disbanded';
create unique index guilds_tag_key on public.guilds (tag) where status <> 'disbanded';
create unique index guilds_join_code_key on public.guilds (join_code) where status <> 'disbanded';

-- One row per stretch of membership: leaving and coming back is a new row, so the
-- history of who was in which guild when stays true (court-time XP depends on it).
create table public.guild_members (
  id         uuid primary key default gen_random_uuid(),
  guild_id   uuid not null references public.guilds on delete cascade,
  user_id    uuid not null references auth.users on delete cascade,
  role       public.guild_role not null default 'member',
  status     text not null default 'active' check (status in ('active', 'left', 'removed', 'disbanded')),
  joined_at  timestamptz not null default now(),
  left_at    timestamptz,
  check ((status = 'active') = (left_at is null))
);
create unique index guild_members_one_guild on public.guild_members (user_id) where status = 'active';
create unique index guild_members_one_leader on public.guild_members (guild_id) where status = 'active' and role = 'leader';
create index guild_members_guild_idx on public.guild_members (guild_id, status);
create index guild_members_history_idx on public.guild_members (user_id, joined_at);

create table public.guild_join_requests (
  id          uuid primary key default gen_random_uuid(),
  guild_id    uuid not null references public.guilds on delete cascade,
  user_id     uuid not null references auth.users on delete cascade,
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  created_at  timestamptz not null default now(),
  decided_by  uuid references auth.users on delete set null,
  decided_at  timestamptz
);
create unique index guild_join_requests_one_pending on public.guild_join_requests (user_id) where status = 'pending';
create index guild_join_requests_guild_idx on public.guild_join_requests (guild_id, status);

-- Every point a guild earns, once. user_id is null for a guild-wide award (a rally night).
create table public.guild_xp_events (
  id          uuid primary key default gen_random_uuid(),
  guild_id    uuid not null references public.guilds on delete cascade,
  user_id     uuid references auth.users on delete set null,
  source      text not null check (source in ('match', 'win', 'court_hours', 'rally', 'reversal')),
  source_id   uuid not null,
  party_id    uuid,
  xp          integer not null,
  created_at  timestamptz not null default now()
);
create unique index guild_xp_events_once_per_player on public.guild_xp_events (user_id, source, source_id) where user_id is not null;
-- Guild-wide awards only: a player's own rows also end up with a null user_id when the
-- account is deleted, and two teammates' rows for one match must not then collide.
create unique index guild_xp_events_once_per_guild on public.guild_xp_events (guild_id, source, source_id)
  where user_id is null and source = 'rally';
create index guild_xp_events_guild_source_idx on public.guild_xp_events (guild_id, source);
create index guild_xp_events_guild_idx on public.guild_xp_events (guild_id, created_at desc);
create index guild_xp_events_party_idx on public.guild_xp_events (party_id) where party_id is not null;

create table public.guild_seasons (
  season_month  date primary key,
  closed_at     timestamptz not null default now()
);

create table public.guild_season_results (
  season_month  date not null references public.guild_seasons,
  guild_id      uuid not null references public.guilds on delete cascade,
  xp            integer not null,
  rank          integer not null,
  primary key (season_month, guild_id)
);

-- Season badges carry their month in the code (season_1_2026_10), so one key covers all.
create table public.guild_badges (
  guild_id      uuid not null references public.guilds on delete cascade,
  code          text not null,
  season_month  date,
  earned_at     timestamptz not null default now(),
  primary key (guild_id, code)
);

create table public.guild_reports (
  id           uuid primary key default gen_random_uuid(),
  guild_id     uuid not null references public.guilds on delete cascade,
  reporter_id  uuid not null references auth.users on delete cascade,
  reason       text not null check (char_length(btrim(reason)) between 1 and 300),
  status       text not null default 'open' check (status in ('open', 'actioned', 'dismissed')),
  created_at   timestamptz not null default now(),
  handled_by   uuid references auth.users,
  handled_at   timestamptz,
  unique (guild_id, reporter_id)
);
create index guild_reports_open_idx on public.guild_reports (status, created_at);

-- A ก๊วน room can say which guild it belongs to. Nothing else about rooms changes.
alter table public.party_rooms add column if not exists guild_id uuid references public.guilds on delete set null;
create index if not exists party_rooms_guild_idx on public.party_rooms (guild_id) where guild_id is not null;

-- ---------------------------------------------------------------------------
-- The public side. No user id anywhere.
-- ---------------------------------------------------------------------------
create table public.guild_board (
  guild_id      uuid primary key references public.guilds on delete cascade,
  name          text not null,
  tag           text not null,
  emblem        text not null,
  color         text not null,
  description   text,
  join_policy   text not null,
  member_count  integer not null,
  level         integer not null,
  total_xp      integer not null,
  season_xp     integer not null,
  skill_rating  integer,
  created_at    timestamptz not null,
  updated_at    timestamptz not null default now()
);
create index guild_board_season_idx on public.guild_board (season_xp desc);
create index guild_board_total_idx on public.guild_board (total_xp desc);

-- entry_id is the membership row, not the account. player_key and name are null for a
-- member who is off the ladder: they still count, they just are not named.
create table public.guild_member_board (
  entry_id    uuid primary key references public.guild_members on delete cascade,
  guild_id    uuid not null references public.guilds on delete cascade,
  player_key  uuid,
  name        text,
  avatar_url  text,
  role        public.guild_role not null,
  joined_at   timestamptz not null
);
create index guild_member_board_guild_idx on public.guild_member_board (guild_id);

alter table public.guilds enable row level security;
alter table public.guild_members enable row level security;
alter table public.guild_join_requests enable row level security;
alter table public.guild_xp_events enable row level security;
alter table public.guild_seasons enable row level security;
alter table public.guild_season_results enable row level security;
alter table public.guild_badges enable row level security;
alter table public.guild_reports enable row level security;
alter table public.guild_board enable row level security;
alter table public.guild_member_board enable row level security;

create policy "admins read guilds" on public.guilds for select to authenticated using (is_admin());
create policy "admins read guild reports" on public.guild_reports for select to authenticated using (is_admin());
create policy "guilds are for signed-in players" on public.guild_board
  for select to authenticated using (true);
create policy "guild members are for signed-in players" on public.guild_member_board
  for select to authenticated using (true);
create policy "seasons are for signed-in players" on public.guild_seasons
  for select to authenticated using (true);
create policy "season results of listed guilds" on public.guild_season_results
  for select to authenticated using (exists (select 1 from guild_board b where b.guild_id = guild_season_results.guild_id));
create policy "badges of listed guilds" on public.guild_badges
  for select to authenticated using (exists (select 1 from guild_board b where b.guild_id = guild_badges.guild_id));

-- ---------------------------------------------------------------------------
-- Keeping the boards true.
-- ---------------------------------------------------------------------------
create or replace function public.guild_month_start(p_at timestamptz) returns timestamptz
language sql stable as $$
  select date_trunc('month', p_at at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok'
$$;

create or replace function public.sync_guild_board(p_guild_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_guild guilds; v_total integer; v_season integer; v_members integer; v_skill integer;
begin
  select * into v_guild from guilds where id = p_guild_id;
  if not found or v_guild.status <> 'active' then
    delete from guild_member_board where guild_id = p_guild_id;
    delete from guild_board where guild_id = p_guild_id;
    return;
  end if;

  select coalesce(sum(xp), 0)::integer into v_total from guild_xp_events where guild_id = p_guild_id;
  select coalesce(sum(xp), 0)::integer into v_season from guild_xp_events
    where guild_id = p_guild_id and created_at >= guild_month_start(now());
  select count(*)::integer into v_members from guild_members where guild_id = p_guild_id and status = 'active';
  -- Strength: the average of the four best ladder ratings, once four members have one.
  select case when count(*) >= 4 then round(avg(rating))::integer end into v_skill
  from (select r.rating from guild_members m join player_ratings r on r.user_id = m.user_id
        where m.guild_id = p_guild_id and m.status = 'active' and r.played > 0
        order by r.rating desc limit 4) best;

  insert into guild_board (guild_id, name, tag, emblem, color, description, join_policy, member_count,
                           level, total_xp, season_xp, skill_rating, created_at, updated_at)
  values (v_guild.id, v_guild.name, v_guild.tag, v_guild.emblem, v_guild.color, v_guild.description,
          v_guild.join_policy, v_members, guild_level(v_total), v_total, v_season, v_skill, v_guild.created_at, now())
  on conflict (guild_id) do update set
    name = excluded.name, tag = excluded.tag, emblem = excluded.emblem, color = excluded.color,
    description = excluded.description, join_policy = excluded.join_policy,
    member_count = excluded.member_count, level = excluded.level, total_xp = excluded.total_xp,
    season_xp = excluded.season_xp, skill_rating = excluded.skill_rating, updated_at = now();
end $$;

create or replace function public.sync_guild_member(p_entry_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_member guild_members; v_profile profiles; v_shown boolean;
begin
  select * into v_member from guild_members where id = p_entry_id;
  if not found or v_member.status <> 'active'
     or not exists (select 1 from guilds where id = v_member.guild_id and status = 'active') then
    delete from guild_member_board where entry_id = p_entry_id;
    return;
  end if;
  select * into v_profile from profiles where id = v_member.user_id;
  v_shown := coalesce(v_profile.show_on_leaderboard, true);

  insert into guild_member_board (entry_id, guild_id, player_key, name, avatar_url, role, joined_at)
  values (v_member.id, v_member.guild_id,
          case when v_shown then v_profile.public_player_id end,
          case when v_shown then coalesce(nullif(btrim(v_profile.display_name), ''), 'ผู้เล่น') end,
          case when v_shown then v_profile.avatar_url end,
          v_member.role, v_member.joined_at)
  on conflict (entry_id) do update set
    player_key = excluded.player_key, name = excluded.name, avatar_url = excluded.avatar_url, role = excluded.role;
end $$;

-- Badges a guild has earned by now. Each is given once and never taken back.
create or replace function public.refresh_guild_badges(p_guild_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_total integer; v_rallies integer; v_wins integer; v_members integer; v_level integer;
begin
  select coalesce(sum(xp), 0)::integer,
         count(*) filter (where source = 'rally')::integer,
         count(*) filter (where source = 'win')::integer
    into v_total, v_rallies, v_wins
  from guild_xp_events where guild_id = p_guild_id;
  select count(*)::integer into v_members from guild_members where guild_id = p_guild_id and status = 'active';
  v_level := guild_level(v_total);

  insert into guild_badges (guild_id, code)
  select p_guild_id, code from (values
    ('first_rally', v_rallies >= 1),
    ('rally_10', v_rallies >= 10),
    ('level_5', v_level >= 5),
    ('level_10', v_level >= 10),
    ('level_20', v_level >= 20),
    ('members_10', v_members >= 10),
    ('wins_100', v_wins >= 100)
  ) as earned(code, ok)
  where ok
  on conflict (guild_id, code) do nothing;
end $$;

create or replace function public.guild_changed() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_entry uuid;
begin
  perform sync_guild_board(new.id);
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    for v_entry in select id from guild_members where guild_id = new.id and status = 'active' loop
      perform sync_guild_member(v_entry);
    end loop;
  end if;
  return new;
end $$;

create trigger guilds_sync after insert or update on public.guilds
  for each row execute function public.guild_changed();

create or replace function public.guild_member_changed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform sync_guild_member(new.id);
  perform sync_guild_board(new.guild_id);
  perform refresh_guild_badges(new.guild_id);
  return new;
end $$;

create trigger guild_members_sync after insert or update on public.guild_members
  for each row execute function public.guild_member_changed();

-- A deleted account takes its membership rows with it (on delete cascade). If that was the
-- leader, whoever has been in the guild longest takes over, officers first; a guild with
-- nobody left is closed.
create or replace function public.guild_member_deleted() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_next uuid;
begin
  if old.status = 'active' and old.role = 'leader' then
    select id into v_next from guild_members
      where guild_id = old.guild_id and status = 'active' and id <> old.id
      order by (role = 'officer') desc, joined_at
      limit 1;
    if v_next is null then
      update guilds set status = 'disbanded', status_note = 'leader account deleted', updated_at = now()
        where id = old.guild_id;
    else
      update guild_members set role = 'leader' where id = v_next;
    end if;
  end if;
  perform sync_guild_board(old.guild_id);
  return old;
end $$;

create trigger guild_members_deleted after delete on public.guild_members
  for each row execute function public.guild_member_deleted();

-- XP arrives inside a match being recorded, so this stays small: add to the running
-- totals instead of re-adding the guild's whole history, and never let a fault here stop
-- the match. A hidden guild has no board row; restoring it recounts everything.
create or replace function public.guild_xp_added() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_level integer; v_count integer;
begin
  begin
    update guild_board
    set total_xp = total_xp + new.xp,
        season_xp = season_xp + case when new.created_at >= guild_month_start(now()) then new.xp else 0 end,
        level = guild_level(total_xp + new.xp),
        updated_at = now()
    where guild_id = new.guild_id
    returning level into v_level;

    if v_level is not null then
      insert into guild_badges (guild_id, code)
      select new.guild_id, b.code from (values ('level_5', 5), ('level_10', 10), ('level_20', 20)) as b(code, at_level)
      where v_level >= b.at_level
      on conflict (guild_id, code) do nothing;
    end if;
    if new.source in ('rally', 'win') then
      select count(*)::integer into v_count from guild_xp_events where guild_id = new.guild_id and source = new.source;
      insert into guild_badges (guild_id, code)
      select new.guild_id, b.code
      from (values ('rally', 'first_rally', 1), ('rally', 'rally_10', 10), ('win', 'wins_100', 100)) as b(source, code, at_count)
      where b.source = new.source and v_count >= b.at_count
      on conflict (guild_id, code) do nothing;
    end if;
  exception when others then
    raise warning 'guild board for % not updated: %', new.guild_id, sqlerrm;
  end;
  return new;
end $$;

create trigger guild_xp_events_sync after insert on public.guild_xp_events
  for each row execute function public.guild_xp_added();

-- A new name, picture or ladder choice follows into the member list.
create or replace function public.guild_profile_changed() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_entry uuid;
begin
  begin
    for v_entry in select id from guild_members where user_id = new.id and status = 'active' loop
      perform sync_guild_member(v_entry);
    end loop;
  exception when others then
    raise warning 'guild member list for % not updated: %', new.id, sqlerrm;
  end;
  return new;
end $$;

create trigger profiles_sync_guilds after update of display_name, avatar_url, show_on_leaderboard on public.profiles
  for each row execute function public.guild_profile_changed();

-- A rating change moves the guild's strength. This runs inside record_party_result, so it
-- touches only the strength column and swallows its own faults (a lock wait between two
-- rooms included) rather than abort the result being recorded.
create or replace function public.guild_rating_changed() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_guild uuid;
begin
  begin
    select guild_id into v_guild from guild_members where user_id = new.user_id and status = 'active';
    if v_guild is not null then
      update guild_board set skill_rating = (
        select case when count(*) >= 4 then round(avg(rating))::integer end
        from (select r.rating from guild_members m join player_ratings r on r.user_id = m.user_id
              where m.guild_id = v_guild and m.status = 'active' and r.played > 0
              order by r.rating desc limit 4) best)
      where guild_id = v_guild;
    end if;
  exception when others then
    raise warning 'guild strength for % not updated: %', v_guild, sqlerrm;
  end;
  return new;
end $$;

create trigger player_ratings_sync_guilds after insert or update on public.player_ratings
  for each row execute function public.guild_rating_changed();

-- ---------------------------------------------------------------------------
-- Membership. Every rule is checked here, where calling the API directly cannot skip it.
-- ---------------------------------------------------------------------------

-- Free while guilds launch. The single switch for a future condition (a membership plan,
-- a minimum number of visits): change this body and nothing else.
create or replace function public.can_create_guild(p_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_user_id is not null
$$;

-- A guild code lasts for months, unlike a room code, so it is longer (8 characters, about
-- 3.8 × 10^11 codes) and drawn from gen_random_uuid(), which is cryptographically random,
-- rather than random(). Same alphabet as room codes: no 0 O 1 I L.
create or replace function public.new_guild_join_code() returns text
language plpgsql security definer set search_path = public as $$
declare
  v_alphabet text := '23456789BCDFGHJKMNPQRSTVWXYZ';
  -- Bytes of a v4 uuid that are fully random (6 and 8 carry the version and variant).
  v_random_bytes integer[] := array[0, 1, 2, 3, 4, 5, 9, 10];
  v_bytes bytea;
  v_byte integer;
  v_code text;
  v_try integer := 0;
begin
  loop
    v_bytes := uuid_send(gen_random_uuid());
    v_code := '';
    foreach v_byte in array v_random_bytes loop
      v_code := v_code || substr(v_alphabet, 1 + get_byte(v_bytes, v_byte) % length(v_alphabet), 1);
    end loop;
    exit when not exists (select 1 from guilds where join_code = v_code and status <> 'disbanded');
    v_try := v_try + 1;
    if v_try > 50 then raise exception 'BUSY_TRY_AGAIN' using errcode = '40001'; end if;
  end loop;
  return v_code;
end $$;

-- The one way into a guild. Locks the guild so two people cannot take the last place.
create or replace function public.guild_add_member(p_guild_id uuid, p_user_id uuid, p_role public.guild_role)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  c_max_members constant integer := 30;
  c_cooldown constant interval := interval '3 days';
  v_guild guilds; v_entry uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 40));
  select * into v_guild from guilds where id = p_guild_id for update;
  if not found or v_guild.status <> 'active' then
    raise exception 'GUILD_NOT_FOUND' using errcode = 'P0002';
  end if;
  if exists (select 1 from guild_members where user_id = p_user_id and status = 'active') then
    raise exception 'ALREADY_IN_GUILD' using errcode = '23505';
  end if;
  if exists (select 1 from guild_members where user_id = p_user_id and status = 'left'
             and left_at > now() - c_cooldown) then
    raise exception 'GUILD_COOLDOWN' using errcode = '22023';
  end if;
  if (select count(*) from guild_members where guild_id = p_guild_id and status = 'active') >= c_max_members then
    raise exception 'GUILD_FULL' using errcode = '22023';
  end if;

  insert into guild_members (guild_id, user_id, role) values (p_guild_id, p_user_id, p_role) returning id into v_entry;
  -- Whatever else they had asked to join is settled now.
  update guild_join_requests set status = 'withdrawn', decided_at = now()
    where user_id = p_user_id and status = 'pending';
  return v_entry;
end $$;

-- Leader or officer of this guild? (Officers can do everything except the leader's three.)
create or replace function public.guild_role_of(p_guild_id uuid, p_user_id uuid)
returns public.guild_role language sql stable security definer set search_path = public as $$
  select role from guild_members where guild_id = p_guild_id and user_id = p_user_id and status = 'active'
$$;

create or replace function public.create_guild(
  p_name text, p_tag text, p_emblem text, p_color text, p_description text, p_join_policy text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  c_create_every constant interval := interval '7 days';
  v_uid uuid := auth.uid();
  v_name text := clean_party_text(p_name, 24);
  v_tag text := upper(btrim(coalesce(p_tag, '')));
  v_description text := clean_party_text(p_description, 200);
  v_style record;
  v_guild uuid;
begin
  if v_uid is null then raise exception 'LOGIN_REQUIRED' using errcode = '42501'; end if;
  if not (select creation_open from guild_settings where id = 1) then
    raise exception 'GUILD_CREATION_CLOSED' using errcode = '42501';
  end if;
  if not can_create_guild(v_uid) then raise exception 'FORBIDDEN' using errcode = '42501'; end if;

  select * into v_style from guild_style_options();
  -- coalesce: a null emblem makes "= any" null, and "not null" would let it through.
  if v_name is null or char_length(v_name) < 3 or v_tag !~ '^[A-Z0-9ก-๙]{2,4}$'
     or not coalesce(p_emblem = any(v_style.emblems), false) or not coalesce(p_color = any(v_style.colors), false)
     or coalesce(p_join_policy, '') not in ('open', 'approval', 'code') then
    raise exception 'INVALID_GUILD' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 40));
  if exists (select 1 from guild_members where user_id = v_uid and status = 'active') then
    raise exception 'ALREADY_IN_GUILD' using errcode = '23505';
  end if;
  if exists (select 1 from guilds where created_by = v_uid and created_at > now() - c_create_every) then
    raise exception 'TOO_MANY_GUILDS' using errcode = '22023';
  end if;
  if exists (select 1 from guilds where name_key = lower(v_name) and status <> 'disbanded') then
    raise exception 'GUILD_NAME_TAKEN' using errcode = '23505';
  end if;
  if exists (select 1 from guilds where tag = v_tag and status <> 'disbanded') then
    raise exception 'GUILD_TAG_TAKEN' using errcode = '23505';
  end if;

  begin
    insert into guilds (name, name_key, tag, emblem, color, description, join_policy, join_code, created_by)
    values (v_name, lower(v_name), v_tag, p_emblem, p_color, v_description, p_join_policy, new_guild_join_code(), v_uid)
    returning id into v_guild;
  exception when unique_violation then
    -- Two people picked the same name or tag in the same instant: answer like the checks above.
    if exists (select 1 from guilds where name_key = lower(v_name) and status <> 'disbanded') then
      raise exception 'GUILD_NAME_TAKEN' using errcode = '23505';
    end if;
    raise exception 'GUILD_TAG_TAKEN' using errcode = '23505';
  end;
  perform guild_add_member(v_guild, v_uid, 'leader');
  return v_guild;
end $$;

-- The leader and officers can change how the guild looks and who may join. The name and
-- tag stay as they were created (an admin can rename), so a guild cannot become someone
-- else overnight.
create or replace function public.update_guild(
  p_guild_id uuid, p_description text, p_emblem text, p_color text, p_join_policy text
) returns void language plpgsql security definer set search_path = public as $$
declare v_style record;
begin
  if coalesce(guild_role_of(p_guild_id, auth.uid())::text, 'member') = 'member' then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select * into v_style from guild_style_options();
  if not coalesce(p_emblem = any(v_style.emblems), false) or not coalesce(p_color = any(v_style.colors), false)
     or coalesce(p_join_policy, '') not in ('open', 'approval', 'code') then
    raise exception 'INVALID_GUILD' using errcode = '22023';
  end if;
  update guilds set description = clean_party_text(p_description, 200), emblem = p_emblem, color = p_color,
                    join_policy = p_join_policy, updated_at = now()
    where id = p_guild_id and status = 'active';
  if not found then raise exception 'GUILD_NOT_FOUND' using errcode = 'P0002'; end if;
end $$;

create or replace function public.reset_guild_join_code(p_guild_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  if coalesce(guild_role_of(p_guild_id, auth.uid())::text, 'member') = 'member' then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  v_code := new_guild_join_code();
  update guilds set join_code = v_code, updated_at = now() where id = p_guild_id and status = 'active';
  if not found then raise exception 'GUILD_NOT_FOUND' using errcode = 'P0002'; end if;
  return v_code;
end $$;

-- Straight in: an open guild, or anyone holding the guild's code.
create or replace function public.join_guild(p_guild_id uuid, p_code text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_guild guilds;
begin
  if v_uid is null then raise exception 'LOGIN_REQUIRED' using errcode = '42501'; end if;
  select * into v_guild from guilds where id = p_guild_id and status = 'active';
  if not found then raise exception 'GUILD_NOT_FOUND' using errcode = 'P0002'; end if;
  if p_code is not null then
    if upper(btrim(p_code)) <> v_guild.join_code then
      raise exception 'WRONG_GUILD_CODE' using errcode = '22023';
    end if;
  elsif v_guild.join_policy = 'approval' then
    raise exception 'GUILD_NEEDS_APPROVAL' using errcode = '22023';
  elsif v_guild.join_policy = 'code' then
    raise exception 'WRONG_GUILD_CODE' using errcode = '22023';
  end if;
  return guild_add_member(p_guild_id, v_uid, 'member');
end $$;

-- A shared code or QR is enough on its own: no need to find the guild first.
create or replace function public.join_guild_by_code(p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_guild uuid;
begin
  if auth.uid() is null then raise exception 'LOGIN_REQUIRED' using errcode = '42501'; end if;
  select id into v_guild from guilds where join_code = upper(btrim(coalesce(p_code, ''))) and status = 'active';
  if v_guild is null then raise exception 'WRONG_GUILD_CODE' using errcode = '22023'; end if;
  perform join_guild(v_guild, p_code);
  return v_guild;
end $$;

create or replace function public.request_join_guild(p_guild_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare c_max_per_day constant integer := 10; v_uid uuid := auth.uid(); v_id uuid;
begin
  if v_uid is null then raise exception 'LOGIN_REQUIRED' using errcode = '42501'; end if;
  if not exists (select 1 from guilds where id = p_guild_id and status = 'active' and join_policy = 'approval') then
    raise exception 'GUILD_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 40));
  if exists (select 1 from guild_members where user_id = v_uid and status = 'active') then
    raise exception 'ALREADY_IN_GUILD' using errcode = '23505';
  end if;
  if exists (select 1 from guild_join_requests where user_id = v_uid and status = 'pending') then
    raise exception 'GUILD_REQUEST_PENDING' using errcode = '23505';
  end if;
  -- Same cooldown as joining, so a leader is never left approving someone who cannot join.
  if exists (select 1 from guild_members where user_id = v_uid and status = 'left'
             and left_at > now() - interval '3 days') then
    raise exception 'GUILD_COOLDOWN' using errcode = '22023';
  end if;
  if (select count(*) from guild_join_requests where user_id = v_uid and created_at > now() - interval '1 day') >= c_max_per_day then
    raise exception 'TOO_MANY_REQUESTS' using errcode = '22023';
  end if;
  insert into guild_join_requests (guild_id, user_id) values (p_guild_id, v_uid) returning id into v_id;
  return v_id;
end $$;

create or replace function public.withdraw_guild_request() returns void
language plpgsql security definer set search_path = public as $$
begin
  update guild_join_requests set status = 'withdrawn', decided_at = now()
    where user_id = auth.uid() and status = 'pending';
  if not found then raise exception 'GUILD_REQUEST_NOT_FOUND' using errcode = 'P0002'; end if;
end $$;

create or replace function public.decide_guild_request(p_request_id uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v_request guild_join_requests; v_user uuid;
begin
  -- Take the applicant's lock before the request row, in the same order guild_add_member
  -- does, so approving cannot deadlock with the applicant joining somewhere else.
  select user_id into v_user from guild_join_requests where id = p_request_id;
  if v_user is not null then perform pg_advisory_xact_lock(hashtextextended(v_user::text, 40)); end if;
  select * into v_request from guild_join_requests where id = p_request_id and status = 'pending' for update;
  if not found then raise exception 'GUILD_REQUEST_NOT_FOUND' using errcode = 'P0002'; end if;
  if coalesce(guild_role_of(v_request.guild_id, auth.uid())::text, 'member') = 'member' then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_approve then
    perform guild_add_member(v_request.guild_id, v_request.user_id, 'member');
  end if;
  update guild_join_requests
  set status = case when p_approve then 'approved' else 'rejected' end, decided_by = auth.uid(), decided_at = now()
  where id = p_request_id;
end $$;

-- Leaving. The leader hands over first; a leader on their own closes the guild.
create or replace function public.leave_guild() returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_member guild_members;
begin
  select * into v_member from guild_members where user_id = v_uid and status = 'active';
  if not found then raise exception 'NOT_IN_GUILD' using errcode = 'P0002'; end if;
  -- Lock the guild like guild_add_member does, so nobody joins as the last leader leaves.
  perform 1 from guilds where id = v_member.guild_id for update;
  if v_member.role = 'leader' then
    if exists (select 1 from guild_members where guild_id = v_member.guild_id and status = 'active' and id <> v_member.id) then
      raise exception 'LEADER_MUST_TRANSFER' using errcode = '22023';
    end if;
    -- Closing also settles any waiting requests, so nobody is left stuck "pending".
    perform guild_close_down(v_member.guild_id, 'leader left');
    return;
  end if;
  update guild_members set status = 'left', left_at = now() where id = v_member.id;
end $$;

-- The leader removes officers or members; an officer removes members only.
create or replace function public.kick_guild_member(p_entry_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_target guild_members; v_actor public.guild_role;
begin
  select * into v_target from guild_members where id = p_entry_id and status = 'active' for update;
  if not found then raise exception 'MEMBER_NOT_FOUND' using errcode = 'P0002'; end if;
  v_actor := guild_role_of(v_target.guild_id, auth.uid());
  if v_target.user_id = auth.uid() or v_actor is null or v_actor = 'member'
     or v_target.role = 'leader' or (v_actor = 'officer' and v_target.role <> 'member') then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  update guild_members set status = 'removed', left_at = now() where id = p_entry_id;
end $$;

create or replace function public.set_guild_officer(p_entry_id uuid, p_is_officer boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_target guild_members;
begin
  select * into v_target from guild_members where id = p_entry_id and status = 'active' for update;
  if not found then raise exception 'MEMBER_NOT_FOUND' using errcode = 'P0002'; end if;
  if guild_role_of(v_target.guild_id, auth.uid()) is distinct from 'leader' or v_target.role = 'leader' then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  update guild_members set role = case when p_is_officer then 'officer'::guild_role else 'member'::guild_role end
    where id = p_entry_id;
end $$;

create or replace function public.transfer_guild_leader(p_entry_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_target guild_members;
begin
  select * into v_target from guild_members where id = p_entry_id and status = 'active' for update;
  if not found then raise exception 'MEMBER_NOT_FOUND' using errcode = 'P0002'; end if;
  if guild_role_of(v_target.guild_id, auth.uid()) is distinct from 'leader' or v_target.user_id = auth.uid() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  -- Step down first: a guild has exactly one leader at every moment.
  update guild_members set role = 'officer'
    where guild_id = v_target.guild_id and user_id = auth.uid() and status = 'active';
  update guild_members set role = 'leader' where id = p_entry_id;
end $$;

create or replace function public.guild_close_down(p_guild_id uuid, p_note text) returns void
language plpgsql security definer set search_path = public as $$
begin
  update guilds set status = 'disbanded', status_note = p_note, updated_at = now() where id = p_guild_id;
  update guild_members set status = 'disbanded', left_at = now() where guild_id = p_guild_id and status = 'active';
  update guild_join_requests set status = 'rejected', decided_at = now() where guild_id = p_guild_id and status = 'pending';
end $$;

create or replace function public.disband_guild(p_guild_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if guild_role_of(p_guild_id, auth.uid()) is distinct from 'leader' then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  -- A guild an admin has hidden stays hidden: the leader cannot close it to free the name.
  if not exists (select 1 from guilds where id = p_guild_id and status = 'active') then
    raise exception 'GUILD_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform guild_close_down(p_guild_id, 'leader');
end $$;

-- The host of a room marks it as their guild's night (or takes the mark off). Joining the
-- room works exactly as before; this only adds a label and a place on the guild page.
create or replace function public.tag_party_with_guild(p_party_id uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_guild uuid;
begin
  if not exists (select 1 from party_rooms where id = p_party_id and host_user_id = v_uid
                 and status in ('pending_payment', 'open')) then
    raise exception 'PARTY_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_on then
    select guild_id into v_guild from guild_members where user_id = v_uid and status = 'active';
    if v_guild is null then raise exception 'NOT_IN_GUILD' using errcode = 'P0002'; end if;
  end if;
  update party_rooms set guild_id = v_guild, updated_at = now() where id = p_party_id;
end $$;

-- ---------------------------------------------------------------------------
-- What a player's own pages need.
-- ---------------------------------------------------------------------------

-- Always one row, so /me can show "no guild yet", a waiting request or a cooldown.
create or replace function public.my_guild()
returns table (
  guild_id uuid, entry_id uuid, role public.guild_role, joined_at timestamptz, join_code text,
  pending_requests integer, cooldown_until timestamptz, requested_guild_id uuid
) language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_member guild_members;
begin
  if v_uid is null then raise exception 'LOGIN_REQUIRED' using errcode = '42501'; end if;
  select * into v_member from guild_members m where m.user_id = v_uid and m.status = 'active';
  return query select
    v_member.guild_id, v_member.id, v_member.role, v_member.joined_at,
    case when v_member.role in ('leader', 'officer') then (select g.join_code from guilds g where g.id = v_member.guild_id) end,
    case when v_member.role in ('leader', 'officer')
      then (select count(*)::integer from guild_join_requests r where r.guild_id = v_member.guild_id and r.status = 'pending') end,
    (select max(m.left_at) + interval '3 days' from guild_members m
      where m.user_id = v_uid and m.status = 'left' and m.left_at > now() - interval '3 days'),
    (select r.guild_id from guild_join_requests r where r.user_id = v_uid and r.status = 'pending');
end $$;

-- The leader's inbox: who asked to join, with what the ladder knows about them.
create or replace function public.guild_requests(p_guild_id uuid)
returns table (request_id uuid, name text, avatar_url text, rating integer, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(guild_role_of(p_guild_id, auth.uid())::text, 'member') = 'member' then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  return query
  select r.id, coalesce(nullif(btrim(p.display_name), ''), 'ผู้เล่น'), p.avatar_url, pr.rating, r.created_at
  from guild_join_requests r
  join profiles p on p.id = r.user_id
  left join player_ratings pr on pr.user_id = r.user_id and pr.played > 0
  where r.guild_id = p_guild_id and r.status = 'pending'
  order by r.created_at;
end $$;

-- Recent XP on a guild page. Names follow the ladder choice; people who left are not named.
create or replace function public.guild_recent_xp(p_guild_id uuid, p_limit integer default 20)
returns table (created_at timestamptz, source text, xp integer, member_name text)
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'LOGIN_REQUIRED' using errcode = '42501'; end if;
  if not exists (select 1 from guild_board where guild_id = p_guild_id) then
    raise exception 'GUILD_NOT_FOUND' using errcode = 'P0002';
  end if;
  return query
  select e.created_at, e.source, e.xp,
    case
      when e.user_id is null then null
      when not exists (select 1 from guild_members m where m.guild_id = p_guild_id and m.user_id = e.user_id and m.status = 'active')
        then 'อดีตสมาชิก'
      when not coalesce(p.show_on_leaderboard, true) then 'สมาชิก'
      else coalesce(nullif(btrim(p.display_name), ''), 'ผู้เล่น')
    end
  from guild_xp_events e
  left join profiles p on p.id = e.user_id
  where e.guild_id = p_guild_id
  order by e.created_at desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
end $$;

-- A guild's coming ก๊วน nights: only what the public room board already shows.
create or replace function public.guild_upcoming_parties(p_guild_id uuid)
returns table (party_id uuid, title text, host_name text, mode public.party_mode, court_id smallint,
               starts_at timestamptz, ends_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.id, r.title, r.host_name, r.mode, r.court_id, r.starts_at, r.ends_at
  from party_rooms r
  where r.guild_id = p_guild_id and r.status = 'open' and r.ends_at > now()
    and exists (select 1 from guild_board b where b.guild_id = p_guild_id)
    -- A private room keeps its time and place to the people who have its code.
    and r.visibility = 'public'
    -- A host who has since left the guild no longer advertises on its page.
    and exists (select 1 from guild_members m where m.guild_id = p_guild_id and m.user_id = r.host_user_id and m.status = 'active')
  order by r.starts_at
  limit 20
$$;

-- ---------------------------------------------------------------------------
-- XP. Only what really happened at the shop, once, to the guild the player was in then.
-- ---------------------------------------------------------------------------
create or replace function public.award_guild_match_xp(
  p_party_id uuid, p_match_id uuid, p_players uuid[], p_winners uuid[]
) returns void language plpgsql security definer set search_path = public as $$
declare
  c_match constant integer := 10;
  c_win constant integer := 5;
  c_daily_cap constant integer := 150;
  c_rally constant integer := 50;
  c_rally_players constant integer := 4;
  v_room party_rooms; v_entry uuid; v_user uuid; v_guild uuid; v_used integer; v_xp integer;
  v_inserted integer; v_day_start timestamptz;
begin
  select * into v_room from party_rooms where id = p_party_id;
  -- Only a room whose court booking is confirmed counts.
  if not found or v_room.status not in ('open', 'closed') then return; end if;
  v_day_start := date_trunc('day', now() at time zone 'Asia/Bangkok') at time zone 'Asia/Bangkok';

  foreach v_entry in array coalesce(p_players, '{}') loop
    select user_id into v_user from party_members where id = v_entry;
    continue when v_user is null;
    select m.guild_id into v_guild from guild_members m join guilds g on g.id = m.guild_id
      where m.user_id = v_user and m.status = 'active' and g.status <> 'disbanded';
    continue when v_guild is null;

    perform pg_advisory_xact_lock(hashtextextended(v_user::text, 41));
    select coalesce(sum(xp), 0)::integer into v_used from guild_xp_events
      where user_id = v_user and source in ('match', 'win') and created_at >= v_day_start;

    v_xp := least(c_match, greatest(0, c_daily_cap - v_used));
    if v_xp > 0 then
      insert into guild_xp_events (guild_id, user_id, source, source_id, party_id, xp)
      values (v_guild, v_user, 'match', p_match_id, p_party_id, v_xp) on conflict do nothing;
      get diagnostics v_inserted = row_count;
      v_used := v_used + v_xp * v_inserted;
    end if;

    if v_room.scoring = 'ranked' and v_entry = any(coalesce(p_winners, '{}')) then
      v_xp := least(c_win, greatest(0, c_daily_cap - v_used));
      if v_xp > 0 then
        insert into guild_xp_events (guild_id, user_id, source, source_id, party_id, xp)
        values (v_guild, v_user, 'win', p_match_id, p_party_id, v_xp) on conflict do nothing;
      end if;
    end if;
  end loop;

  -- A rally night: enough of one guild played in the same room.
  insert into guild_xp_events (guild_id, user_id, source, source_id, party_id, xp)
  select e.guild_id, null, 'rally', p_party_id, p_party_id, c_rally
  from guild_xp_events e
  where e.party_id = p_party_id and e.source = 'match'
  group by e.guild_id
  having count(distinct e.user_id) >= c_rally_players
  on conflict do nothing;
end $$;

-- Guild code must never stop a ก๊วน night: a failure here is logged and the match goes on.
create or replace function public.guild_doubles_match_finished() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'finished' and old.status is distinct from 'finished' and new.winner is not null then
    begin
      perform award_guild_match_xp(
        new.party_id, new.id,
        array(select id from party_members where party_id = new.party_id and status = 'active' and team in (new.team_a, new.team_b)),
        array(select id from party_members where party_id = new.party_id and status = 'active' and team = new.winner));
    exception when others then
      raise warning 'guild XP for match % skipped: %', new.id, sqlerrm;
    end;
  end if;
  return new;
end $$;

create trigger party_match_board_guild_xp after update of status on public.party_match_board
  for each row execute function public.guild_doubles_match_finished();

create or replace function public.guild_singles_match_finished() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'finished' and old.status is distinct from 'finished' and new.winner_entry is not null then
    begin
      perform award_guild_match_xp(new.party_id, new.id,
        array[new.player_a_entry, new.player_b_entry], array[new.winner_entry]);
    exception when others then
      raise warning 'guild XP for match % skipped: %', new.id, sqlerrm;
    end;
  end if;
  return new;
end $$;

create trigger party_singles_match_board_guild_xp after update of status on public.party_singles_match_board
  for each row execute function public.guild_singles_match_finished();

-- Court time, once the booking has been played. Run every hour by pg_cron. Only bookings
-- the customer made online count: phone, LINE and walk-in bookings sit on the admin's
-- account and would otherwise give the admin's guild the shop's whole day.
-- Pay-later counts once it is paid. A booking cancelled afterwards takes its XP back.
create or replace function public.award_guild_court_xp() returns integer
language plpgsql security definer set search_path = public as $$
declare
  c_per_hour constant integer := 20;
  v_added integer; v_reversed integer;
  -- XP is dated when the court was played, unless that month's season is already closed
  -- (a pay-later bill paid in the new month): then it counts in the season still open.
  v_open_from timestamptz := coalesce(
    (select (max(season_month) + interval '1 month')::timestamp at time zone 'Asia/Bangkok' from guild_seasons),
    '-infinity');
begin
  insert into guild_xp_events (guild_id, user_id, source, source_id, xp, created_at)
  select m.guild_id, b.user_id, 'court_hours', b.id,
         round(extract(epoch from b.ends_at - b.starts_at) / 3600.0 * c_per_hour)::integer,
         greatest(b.ends_at, v_open_from)
  from bookings b
  join guild_members m on m.user_id = b.user_id
    and m.joined_at <= b.ends_at and (m.left_at is null or m.left_at > b.ends_at)
  join guilds g on g.id = m.guild_id and g.status <> 'disbanded'
  where b.status = 'confirmed' and b.channel = 'online'
    and not (b.pay_later and b.paid_at is null)
    and b.ends_at <= now() and b.ends_at > now() - interval '7 days'
  on conflict do nothing;
  get diagnostics v_added = row_count;

  insert into guild_xp_events (guild_id, user_id, source, source_id, xp)
  select e.guild_id, e.user_id, 'reversal', e.source_id, -e.xp
  from guild_xp_events e
  join bookings b on b.id = e.source_id
  where e.source = 'court_hours' and b.status = 'cancelled'
  on conflict do nothing;
  get diagnostics v_reversed = row_count;

  return v_added + v_reversed;
end $$;

-- Closes every finished month that is not closed yet: results, ranks, and badges for the
-- top three. Safe to run any number of times. Run daily by pg_cron just after midnight.
create or replace function public.close_guild_season(p_now timestamptz default now()) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_current date := date_trunc('month', p_now at time zone 'Asia/Bangkok')::date;
  v_month date; v_start timestamptz; v_end timestamptz; v_closed integer := 0; v_guild uuid;
begin
  -- Court time from the last evening of the month must be in before the month is ranked.
  perform award_guild_court_xp();
  select (max(season_month) + interval '1 month')::date into v_month from guild_seasons;
  if v_month is null then
    select date_trunc('month', min(created_at) at time zone 'Asia/Bangkok')::date into v_month from guild_xp_events;
  end if;

  while v_month is not null and v_month < v_current loop
    v_start := v_month::timestamp at time zone 'Asia/Bangkok';
    v_end := (v_month + interval '1 month')::timestamp at time zone 'Asia/Bangkok';
    insert into guild_seasons (season_month) values (v_month);

    insert into guild_season_results (season_month, guild_id, xp, rank)
    select v_month, t.guild_id, t.xp, rank() over (order by t.xp desc)
    from (select e.guild_id, sum(e.xp)::integer as xp
          from guild_xp_events e join guilds g on g.id = e.guild_id and g.status = 'active'
          where e.created_at >= v_start and e.created_at < v_end
          group by e.guild_id having sum(e.xp) > 0) t;

    insert into guild_badges (guild_id, code, season_month)
    select r.guild_id, 'season_' || r.rank || '_' || to_char(v_month, 'YYYY_MM'), v_month
    from guild_season_results r where r.season_month = v_month and r.rank <= 3
    on conflict (guild_id, code) do nothing;

    v_closed := v_closed + 1;
    v_month := (v_month + interval '1 month')::date;
  end loop;

  -- A new month: every guild's season XP starts again.
  if v_closed > 0 then
    for v_guild in select id from guilds where status = 'active' loop
      perform sync_guild_board(v_guild);
    end loop;
  end if;
  return v_closed;
end $$;

-- ---------------------------------------------------------------------------
-- Reports and the admin's tools. Nothing is deleted: hidden and disbanded guilds keep
-- their rows, names and history.
-- ---------------------------------------------------------------------------
create or replace function public.report_guild(p_guild_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare c_max_per_hour constant integer := 20; v_uid uuid := auth.uid(); v_reason text := btrim(coalesce(p_reason, ''));
begin
  if v_uid is null then raise exception 'LOGIN_REQUIRED' using errcode = '42501'; end if;
  if char_length(v_reason) < 1 or char_length(v_reason) > 300 then
    raise exception 'INVALID_REPORT' using errcode = '22023';
  end if;
  if not exists (select 1 from guilds where id = p_guild_id and status <> 'disbanded') then
    raise exception 'GUILD_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 42));
  if (select count(*) from guild_reports where reporter_id = v_uid and created_at > now() - interval '1 hour') >= c_max_per_hour then
    raise exception 'TOO_MANY_POSTS' using errcode = '22023';
  end if;
  insert into guild_reports (guild_id, reporter_id, reason) values (p_guild_id, v_uid, v_reason)
  on conflict (guild_id, reporter_id) do update set reason = excluded.reason, status = 'open', created_at = now();
end $$;

create or replace function public.moderate_guild(p_guild_id uuid, p_action text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_note text := left(btrim(coalesce(p_note, '')), 300);
begin
  if not is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if coalesce(p_action, '') not in ('hide', 'restore', 'disband', 'dismiss') then
    raise exception 'INVALID_REPORT' using errcode = '22023';
  end if;
  if p_action = 'hide' then
    update guilds set status = 'hidden', status_note = v_note, updated_at = now() where id = p_guild_id and status = 'active';
  elsif p_action = 'restore' then
    update guilds set status = 'active', status_note = v_note, updated_at = now() where id = p_guild_id and status = 'hidden';
  elsif p_action = 'disband' then
    perform guild_close_down(p_guild_id, coalesce(nullif(v_note, ''), 'admin'));
  end if;
  update guild_reports
  set status = case when p_action = 'dismiss' then 'dismissed' else 'actioned' end, handled_by = auth.uid(), handled_at = now()
  where guild_id = p_guild_id and status = 'open';
end $$;

create or replace function public.admin_rename_guild(p_guild_id uuid, p_name text, p_tag text) returns void
language plpgsql security definer set search_path = public as $$
declare v_name text := clean_party_text(p_name, 24); v_tag text := upper(btrim(coalesce(p_tag, '')));
begin
  if not is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if v_name is null or char_length(v_name) < 3 or v_tag !~ '^[A-Z0-9ก-๙]{2,4}$' then
    raise exception 'INVALID_GUILD' using errcode = '22023';
  end if;
  if exists (select 1 from guilds where name_key = lower(v_name) and status <> 'disbanded' and id <> p_guild_id) then
    raise exception 'GUILD_NAME_TAKEN' using errcode = '23505';
  end if;
  if exists (select 1 from guilds where tag = v_tag and status <> 'disbanded' and id <> p_guild_id) then
    raise exception 'GUILD_TAG_TAKEN' using errcode = '23505';
  end if;
  update guilds set name = v_name, name_key = lower(v_name), tag = v_tag, updated_at = now() where id = p_guild_id;
  if not found then raise exception 'GUILD_NOT_FOUND' using errcode = 'P0002'; end if;
end $$;

create or replace function public.set_guild_creation(p_open boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  if p_open is null then raise exception 'INVALID_GUILD' using errcode = '22023'; end if;
  update guild_settings set creation_open = p_open, updated_at = now() where id = 1;
end $$;

create or replace function public.open_guild_reports()
returns table (report_id uuid, guild_id uuid, guild_name text, guild_tag text, guild_status public.guild_status,
               reason text, created_at timestamptz, reports integer)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'FORBIDDEN' using errcode = '42501'; end if;
  return query
  select r.id, g.id, g.name, g.tag, g.status, r.reason, r.created_at,
         (select count(*)::integer from guild_reports o where o.guild_id = r.guild_id and o.status = 'open')
  from guild_reports r join guilds g on g.id = r.guild_id
  where r.status = 'open'
  order by r.created_at;
end $$;

-- ---------------------------------------------------------------------------
-- Schedules. pg_cron exists on Supabase; the sandbox (PGlite) has no pg_cron, so the
-- schedules are only added where the extension is installed.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('guild-court-xp', '7 * * * *', 'select public.award_guild_court_xp()');
    -- 17:05 UTC is 00:05 in Bangkok.
    perform cron.schedule('guild-season-close', '5 17 * * *', 'select public.close_guild_season()');
  else
    raise warning 'pg_cron is not installed: guild court XP and season closing will not run on their own';
  end if;
end $$;

-- ---------------------------------------------------------------------------
revoke execute on function public.sync_guild_board(uuid) from public, anon, authenticated;
revoke execute on function public.sync_guild_member(uuid) from public, anon, authenticated;
revoke execute on function public.refresh_guild_badges(uuid) from public, anon, authenticated;
revoke execute on function public.guild_changed() from public, anon, authenticated;
revoke execute on function public.guild_member_changed() from public, anon, authenticated;
revoke execute on function public.guild_member_deleted() from public, anon, authenticated;
revoke execute on function public.guild_xp_added() from public, anon, authenticated;
revoke execute on function public.guild_profile_changed() from public, anon, authenticated;
revoke execute on function public.guild_rating_changed() from public, anon, authenticated;
revoke execute on function public.new_guild_join_code() from public, anon, authenticated;
revoke execute on function public.guild_add_member(uuid, uuid, public.guild_role) from public, anon, authenticated;
revoke execute on function public.guild_role_of(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.guild_close_down(uuid, text) from public, anon, authenticated;
revoke execute on function public.can_create_guild(uuid) from public, anon, authenticated;
revoke execute on function public.award_guild_match_xp(uuid, uuid, uuid[], uuid[]) from public, anon, authenticated;
revoke execute on function public.guild_doubles_match_finished() from public, anon, authenticated;
revoke execute on function public.guild_singles_match_finished() from public, anon, authenticated;
revoke execute on function public.award_guild_court_xp() from public, anon, authenticated;
revoke execute on function public.close_guild_season(timestamptz) from public, anon, authenticated;

grant execute on function public.guild_level(integer) to anon, authenticated;
grant execute on function public.guild_style_options() to anon, authenticated;
grant execute on function public.guild_month_start(timestamptz) to anon, authenticated;

revoke execute on function public.create_guild(text, text, text, text, text, text) from public, anon;
grant execute on function public.create_guild(text, text, text, text, text, text) to authenticated;
revoke execute on function public.update_guild(uuid, text, text, text, text) from public, anon;
grant execute on function public.update_guild(uuid, text, text, text, text) to authenticated;
revoke execute on function public.reset_guild_join_code(uuid) from public, anon;
grant execute on function public.reset_guild_join_code(uuid) to authenticated;
revoke execute on function public.join_guild(uuid, text) from public, anon;
grant execute on function public.join_guild(uuid, text) to authenticated;
revoke execute on function public.join_guild_by_code(text) from public, anon;
grant execute on function public.join_guild_by_code(text) to authenticated;
revoke execute on function public.request_join_guild(uuid) from public, anon;
grant execute on function public.request_join_guild(uuid) to authenticated;
revoke execute on function public.withdraw_guild_request() from public, anon;
grant execute on function public.withdraw_guild_request() to authenticated;
revoke execute on function public.decide_guild_request(uuid, boolean) from public, anon;
grant execute on function public.decide_guild_request(uuid, boolean) to authenticated;
revoke execute on function public.leave_guild() from public, anon;
grant execute on function public.leave_guild() to authenticated;
revoke execute on function public.kick_guild_member(uuid) from public, anon;
grant execute on function public.kick_guild_member(uuid) to authenticated;
revoke execute on function public.set_guild_officer(uuid, boolean) from public, anon;
grant execute on function public.set_guild_officer(uuid, boolean) to authenticated;
revoke execute on function public.transfer_guild_leader(uuid) from public, anon;
grant execute on function public.transfer_guild_leader(uuid) to authenticated;
revoke execute on function public.disband_guild(uuid) from public, anon;
grant execute on function public.disband_guild(uuid) to authenticated;
revoke execute on function public.tag_party_with_guild(uuid, boolean) from public, anon;
grant execute on function public.tag_party_with_guild(uuid, boolean) to authenticated;
revoke execute on function public.my_guild() from public, anon;
grant execute on function public.my_guild() to authenticated;
revoke execute on function public.guild_requests(uuid) from public, anon;
grant execute on function public.guild_requests(uuid) to authenticated;
revoke execute on function public.guild_recent_xp(uuid, integer) from public, anon;
grant execute on function public.guild_recent_xp(uuid, integer) to authenticated;
revoke execute on function public.guild_upcoming_parties(uuid) from public, anon;
grant execute on function public.guild_upcoming_parties(uuid) to authenticated;
revoke execute on function public.report_guild(uuid, text) from public, anon;
grant execute on function public.report_guild(uuid, text) to authenticated;
revoke execute on function public.moderate_guild(uuid, text, text) from public, anon;
grant execute on function public.moderate_guild(uuid, text, text) to authenticated;
revoke execute on function public.admin_rename_guild(uuid, text, text) from public, anon;
grant execute on function public.admin_rename_guild(uuid, text, text) to authenticated;
revoke execute on function public.set_guild_creation(boolean) from public, anon;
grant execute on function public.set_guild_creation(boolean) to authenticated;
revoke execute on function public.open_guild_reports() from public, anon;
grant execute on function public.open_guild_reports() to authenticated;

alter publication supabase_realtime add table public.guild_board, public.guild_member_board;

notify pgrst, 'reload schema';
