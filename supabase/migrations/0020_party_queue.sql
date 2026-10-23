-- Turn the customer-facing play queue into paid booking-backed Party rooms.
-- The host pays the existing court booking in full. Guests join for free and
-- settle any shared cost with the host outside this application.

create type public.party_mode as enum ('singles', 'doubles');
create type public.party_status as enum ('pending_payment', 'open', 'closed', 'cancelled');
create type public.party_member_status as enum ('active', 'left', 'kicked');

create table public.party_rooms (
  id           uuid primary key default gen_random_uuid(),
  booking_id   uuid not null unique references public.bookings on delete cascade,
  host_user_id uuid not null references auth.users on delete cascade,
  host_name    text not null check (char_length(host_name) between 1 and 30),
  title        text not null check (char_length(title) between 1 and 60),
  mode         public.party_mode not null,
  capacity     smallint not null default 12 check (capacity between 2 and 12),
  court_id     smallint not null references public.courts,
  starts_at    timestamptz not null,
  ends_at      timestamptz not null,
  status       public.party_status not null default 'pending_payment',
  access_plan  text not null default 'free_launch' check (access_plan in ('free_launch', 'subscription')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (ends_at > starts_at)
);

create table public.party_members (
  id         uuid primary key default gen_random_uuid(),
  party_id   uuid not null references public.party_rooms on delete cascade,
  user_id    uuid not null references auth.users on delete cascade,
  name       text not null check (char_length(name) between 1 and 30),
  slot_no    smallint not null check (slot_no between 1 and 12),
  status     public.party_member_status not null default 'active',
  joined_at  timestamptz not null default now(),
  left_at    timestamptz
);

create unique index party_member_one_active_room
  on public.party_members (party_id, user_id) where status = 'active';
create unique index party_member_one_active_slot
  on public.party_members (party_id, slot_no) where status = 'active';
create index party_rooms_time_idx on public.party_rooms (status, starts_at);
create index party_members_room_idx on public.party_members (party_id, status, slot_no);

-- Public mirrors intentionally contain no user ids.
create table public.party_room_board (
  party_id    uuid primary key references public.party_rooms on delete cascade,
  host_name   text not null,
  title       text not null,
  mode        public.party_mode not null,
  capacity    smallint not null,
  court_id    smallint not null,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null
);

create table public.party_member_board (
  entry_id  uuid primary key references public.party_members on delete cascade,
  party_id  uuid not null references public.party_rooms on delete cascade,
  name      text not null,
  slot_no   smallint not null,
  joined_at timestamptz not null
);

create index party_member_board_room_idx on public.party_member_board (party_id, slot_no);

create or replace function public.sync_party_public_board() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_room party_rooms;
begin
  v_room := case when tg_op = 'DELETE' then old else new end;
  if tg_op <> 'DELETE' and v_room.status = 'open' and v_room.ends_at > now() then
    insert into party_room_board (party_id, host_name, title, mode, capacity, court_id, starts_at, ends_at)
    values (v_room.id, v_room.host_name, v_room.title, v_room.mode,
            v_room.capacity, v_room.court_id, v_room.starts_at, v_room.ends_at)
    on conflict (party_id) do update set
      host_name = excluded.host_name, title = excluded.title, mode = excluded.mode,
      capacity = excluded.capacity, court_id = excluded.court_id,
      starts_at = excluded.starts_at, ends_at = excluded.ends_at;

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

create or replace function public.sync_party_member_board() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_row party_members := case when tg_op = 'DELETE' then old else new end;
begin
  if tg_op <> 'DELETE' and v_row.status = 'active'
     and exists (select 1 from party_rooms where id = v_row.party_id and status = 'open' and ends_at > now()) then
    insert into party_member_board (entry_id, party_id, name, slot_no, joined_at)
    values (v_row.id, v_row.party_id, v_row.name, v_row.slot_no, v_row.joined_at)
    on conflict (entry_id) do update set name = excluded.name, slot_no = excluded.slot_no;
  else
    delete from party_member_board where entry_id = v_row.id;
  end if;
  return coalesce(new, old);
end $$;

create trigger party_rooms_sync_board after insert or update of status, title, mode, capacity, starts_at, ends_at
  on public.party_rooms for each row execute function public.sync_party_public_board();
create trigger party_members_sync_board after insert or update of status, name, slot_no
  on public.party_members for each row execute function public.sync_party_member_board();

-- A booking status change opens or closes its Party automatically.
create or replace function public.sync_party_from_booking() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update party_rooms set
    status = case
      when new.status = 'confirmed' and new.ends_at > now() then 'open'::party_status
      when new.status in ('cancelled', 'expired') then 'cancelled'::party_status
      else status
    end,
    court_id = new.court_id,
    starts_at = new.starts_at,
    ends_at = new.ends_at,
    updated_at = now()
  where booking_id = new.id;
  return new;
end $$;

create trigger bookings_sync_party after update of status, court_id, starts_at, ends_at on public.bookings
  for each row execute function public.sync_party_from_booking();

create or replace function public.clean_party_text(p_value text, p_max int)
returns text language sql immutable set search_path = public as $$
  select nullif(left(regexp_replace(trim(coalesce(p_value, '')), '\s+', ' ', 'g'), p_max), '')
$$;

-- Subscription is intentionally free during launch. Replace this body when paid plans launch.
create or replace function public.can_host_party(p_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_user_id is not null
$$;

create or replace function public.create_party_booking(
  p_court_id smallint,
  p_starts_at timestamptz,
  p_hours numeric,
  p_mode public.party_mode,
  p_title text,
  p_host_name text
)
returns table (party_id uuid, booking_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_booking bookings;
  v_party party_rooms;
  v_title text := clean_party_text(p_title, 60);
  v_name text := clean_party_text(p_host_name, 30);
begin
  if v_uid is null then raise exception 'LOGIN_REQUIRED' using errcode = '42501'; end if;
  if not can_host_party(v_uid) then raise exception 'PARTY_SUBSCRIPTION_REQUIRED' using errcode = '42501'; end if;
  if v_title is null or v_name is null or p_mode is null then
    raise exception 'INVALID_PARTY_DETAILS' using errcode = '22023';
  end if;

  select * into v_booking from public.create_booking(p_court_id, p_starts_at, p_hours);
  insert into party_rooms (booking_id, host_user_id, host_name, title, mode, court_id, starts_at, ends_at)
  values (v_booking.id, v_uid, v_name, v_title, p_mode, p_court_id, v_booking.starts_at, v_booking.ends_at)
  returning * into v_party;
  insert into party_members (party_id, user_id, name, slot_no)
  values (v_party.id, v_uid, v_name, 1);
  return query select v_party.id, v_booking.id;
end $$;

create or replace function public.join_party(p_party_id uuid, p_name text, p_slot_no smallint)
returns public.party_members
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_room party_rooms;
  v_row party_members;
  v_name text := clean_party_text(p_name, 30);
begin
  if v_uid is null then raise exception 'LOGIN_REQUIRED' using errcode = '42501'; end if;
  select * into v_room from party_rooms where id = p_party_id for update;
  if not found or v_room.status <> 'open' or v_room.ends_at <= now() then
    raise exception 'PARTY_NOT_OPEN' using errcode = '22023';
  end if;
  if v_name is null or p_slot_no is null or p_slot_no < 1 or p_slot_no > v_room.capacity then
    raise exception 'INVALID_PARTY_DETAILS' using errcode = '22023';
  end if;
  if (select count(*) from party_members where party_id = p_party_id and status = 'active') >= v_room.capacity then
    raise exception 'PARTY_FULL' using errcode = '22023';
  end if;
  begin
    insert into party_members (party_id, user_id, name, slot_no)
    values (p_party_id, v_uid, v_name, p_slot_no) returning * into v_row;
  exception when unique_violation then
    if exists (select 1 from party_members where party_id = p_party_id and user_id = v_uid and status = 'active') then
      raise exception 'ALREADY_IN_PARTY' using errcode = '23505';
    end if;
    raise exception 'PARTY_SLOT_TAKEN' using errcode = '23505';
  end;
  return v_row;
end $$;

create or replace function public.move_party_slot(p_entry_id uuid, p_slot_no smallint)
returns public.party_members
language plpgsql security definer set search_path = public as $$
declare v_row party_members; v_capacity smallint;
begin
  select m.* into v_row from party_members m join party_rooms r on r.id = m.party_id
  where m.id = p_entry_id and m.user_id = auth.uid() and m.status = 'active' and r.status = 'open' for update of m;
  if not found then raise exception 'PARTY_MEMBER_NOT_FOUND' using errcode = 'P0002'; end if;
  select capacity into v_capacity from party_rooms where id = v_row.party_id;
  if p_slot_no < 1 or p_slot_no > v_capacity then raise exception 'INVALID_PARTY_DETAILS' using errcode = '22023'; end if;
  begin
    update party_members set slot_no = p_slot_no where id = p_entry_id returning * into v_row;
  exception when unique_violation then
    raise exception 'PARTY_SLOT_TAKEN' using errcode = '23505';
  end;
  return v_row;
end $$;

create or replace function public.leave_party(p_entry_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update party_members m set status = 'left', left_at = now()
  from party_rooms r where m.id = p_entry_id and r.id = m.party_id
    and m.user_id = auth.uid() and m.status = 'active' and r.host_user_id <> auth.uid();
  if not found then raise exception 'PARTY_MEMBER_NOT_FOUND' using errcode = 'P0002'; end if;
end $$;

create or replace function public.kick_party_member(p_party_id uuid, p_entry_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update party_members m set status = 'kicked', left_at = now()
  from party_rooms r where r.id = p_party_id and m.party_id = r.id and m.id = p_entry_id
    and r.host_user_id = auth.uid() and m.user_id <> r.host_user_id and m.status = 'active';
  if not found then raise exception 'PARTY_MEMBER_NOT_FOUND' using errcode = 'P0002'; end if;
end $$;

create or replace function public.my_party_entries()
returns table (entry_id uuid, party_id uuid, slot_no smallint, is_host boolean)
language sql stable security definer set search_path = public as $$
  select m.id, m.party_id, m.slot_no, r.host_user_id = auth.uid()
  from party_members m join party_rooms r on r.id = m.party_id
  where m.user_id = auth.uid() and m.status = 'active' and r.status in ('pending_payment', 'open')
$$;

revoke execute on function public.sync_party_public_board() from public, anon, authenticated;
revoke execute on function public.sync_party_member_board() from public, anon, authenticated;
revoke execute on function public.sync_party_from_booking() from public, anon, authenticated;
revoke execute on function public.clean_party_text(text, int) from public, anon, authenticated;
revoke execute on function public.can_host_party(uuid) from public, anon, authenticated;
revoke execute on function public.create_party_booking(smallint, timestamptz, numeric, party_mode, text, text) from public, anon;
revoke execute on function public.join_party(uuid, text, smallint) from public, anon;
revoke execute on function public.move_party_slot(uuid, smallint) from public, anon;
revoke execute on function public.leave_party(uuid) from public, anon;
revoke execute on function public.kick_party_member(uuid, uuid) from public, anon;
revoke execute on function public.my_party_entries() from public, anon;
grant execute on function public.create_party_booking(smallint, timestamptz, numeric, party_mode, text, text) to authenticated;
grant execute on function public.join_party(uuid, text, smallint) to authenticated;
grant execute on function public.move_party_slot(uuid, smallint) to authenticated;
grant execute on function public.leave_party(uuid) to authenticated;
grant execute on function public.kick_party_member(uuid, uuid) to authenticated;
grant execute on function public.my_party_entries() to authenticated;

alter table public.party_rooms enable row level security;
alter table public.party_members enable row level security;
alter table public.party_room_board enable row level security;
alter table public.party_member_board enable row level security;
create policy "party room board is public" on public.party_room_board for select to anon, authenticated using (true);
create policy "party member board is public" on public.party_member_board for select to anon, authenticated using (true);
create policy "party hosts read own room" on public.party_rooms for select to authenticated using (host_user_id = auth.uid() or is_admin());
create policy "party members read self" on public.party_members for select to authenticated using (user_id = auth.uid() or is_admin());

alter publication supabase_realtime add table public.party_room_board, public.party_member_board;
