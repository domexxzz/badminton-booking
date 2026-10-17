-- 0011_venue_settings.sql
-- Allow admins to configure venue opening and closing hours dynamically.
-- Updates opening_hours_ok to read from public.venue_settings instead of hardcoded numbers.

create table if not exists public.venue_settings (
  id           int         primary key check (id = 1),
  open_hour    numeric     not null default 9.0 check (open_hour >= 0 and open_hour < close_hour),
  close_hour   numeric     not null default 23.0 check (close_hour > open_hour and close_hour <= 24.0),
  updated_at   timestamptz not null default now(),
  updated_by   uuid        references auth.users(id)
);

-- Seed default settings (9:00 - 23:00)
insert into public.venue_settings (id, open_hour, close_hour)
values (1, 9.0, 23.0)
on conflict (id) do nothing;

alter table public.venue_settings enable row level security;

-- Anyone can read opening hours (customers and guests need to see slot buttons)
drop policy if exists "venue_settings are public" on public.venue_settings;
create policy "venue_settings are public" on public.venue_settings
  for select to anon, authenticated using (true);

-- Admin update function
create or replace function public.update_venue_hours(p_open_hour numeric, p_close_hour numeric) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if p_open_hour is null or p_close_hour is null
     or p_open_hour < 0 or p_close_hour > 24
     or p_open_hour >= p_close_hour
     or (p_open_hour * 2) <> round(p_open_hour * 2)
     or (p_close_hour * 2) <> round(p_close_hour * 2) then
    raise exception 'INVALID_HOURS' using errcode = '22023';
  end if;

  update public.venue_settings
  set open_hour = p_open_hour,
      close_hour = p_close_hour,
      updated_at = now(),
      updated_by = auth.uid()
  where id = 1;
end $$;

revoke execute on function public.update_venue_hours(numeric, numeric) from public, anon;
grant execute on function public.update_venue_hours(numeric, numeric) to authenticated;

-- Update opening_hours_ok to use dynamic venue_settings (with fallback to 9.0 and 23.0)
create or replace function public.opening_hours_ok(p_starts_at timestamptz, p_hours numeric) returns boolean
language sql stable as $$
  select
    extract(hour from p_starts_at at time zone 'Asia/Bangkok') + (extract(minute from p_starts_at at time zone 'Asia/Bangkok') / 60.0) >= coalesce((select open_hour from public.venue_settings where id = 1), 9.0)
    and extract(hour from p_starts_at at time zone 'Asia/Bangkok') + (extract(minute from p_starts_at at time zone 'Asia/Bangkok') / 60.0) + p_hours <= coalesce((select close_hour from public.venue_settings where id = 1), 23.0)
$$;

-- Allow holding up to 4 courts at once (supports single user booking all 4 courts concurrently)
create or replace function public.create_booking(p_court_id smallint, p_starts_at timestamptz, p_hours numeric)
returns public.bookings
language plpgsql security definer set search_path = public as $$
declare
  c_min_hours     constant numeric := 0.5;
  c_max_hours     constant numeric := 4.0;
  c_max_days      constant int := 14;
  c_hold_minutes  constant int := 5; -- 5-minute hold
  c_max_open      constant int := 4; -- Allow holding all 4 courts concurrently
  c_max_per_hour  constant int := 6;
  v_uid    uuid := auth.uid();
  v_local  timestamp := p_starts_at at time zone 'Asia/Bangkok';
  v_court  courts;
  v_row    bookings;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  if p_hours is null or p_hours < c_min_hours or p_hours > c_max_hours or (p_hours * 2) <> round(p_hours * 2) then
    raise exception 'INVALID_DURATION' using errcode = '22023';
  end if;

  if p_starts_at is null
     or extract(minute from v_local) not in (0, 30)
     or extract(second from v_local) <> 0 then
    raise exception 'INVALID_START' using errcode = '22023';
  end if;

  if p_starts_at <= now() then
    raise exception 'START_IN_PAST' using errcode = '22023';
  end if;

  if p_starts_at > now() + make_interval(days => c_max_days) then
    raise exception 'TOO_FAR_AHEAD' using errcode = '22023';
  end if;

  if not opening_hours_ok(p_starts_at, p_hours) then
    raise exception 'OUTSIDE_OPENING_HOURS' using errcode = '22023';
  end if;

  select * into v_court from courts where id = p_court_id and is_active;
  if not found then
    raise exception 'COURT_NOT_FOUND' using errcode = 'P0002';
  end if;

  perform expire_holds();

  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));

  if (select count(*) from bookings
      where user_id = v_uid and created_at > now() - interval '1 hour') >= c_max_per_hour then
    raise exception 'TOO_MANY_RECENT_BOOKINGS' using errcode = '22023';
  end if;

  if (select count(*) from bookings
      where user_id = v_uid and status in ('pending_payment', 'awaiting_review')) >= c_max_open then
    raise exception 'TOO_MANY_HOLDS' using errcode = '22023';
  end if;

  begin
    insert into bookings (court_id, user_id, starts_at, ends_at, amount, status, hold_expires_at)
    values (
      p_court_id, v_uid, p_starts_at, p_starts_at + make_interval(mins => round(p_hours * 60)::int),
      round(v_court.price_per_hour * p_hours), 'pending_payment',
      now() + make_interval(mins => c_hold_minutes)
    )
    returning * into v_row;
  exception when exclusion_violation then
    raise exception 'SLOT_TAKEN' using errcode = '23P01';
  end;

  return v_row;
end $$;
