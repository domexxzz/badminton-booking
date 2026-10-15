-- 0008_half_hour_and_rules.sql
-- Support 30-minute slots (0.5 hour increments), 5-minute hold timeouts,
-- and update court prices to 150 THB/hr (75 THB per 30 minutes).

-- 1. Update court prices
update public.courts set price_per_hour = 150;

-- 2. Drop old functions with integer signatures
drop function if exists public.opening_hours_ok(timestamptz, int);
drop function if exists public.create_booking(smallint, timestamptz, int);
drop function if exists public.admin_create_booking(smallint, timestamptz, int, text, text, text, text);

-- 3. Opening hours checking supporting numeric duration & 30-min start times
create or replace function public.opening_hours_ok(p_starts_at timestamptz, p_hours numeric) returns boolean
language sql stable as $$
  select
    extract(hour from p_starts_at at time zone 'Asia/Bangkok') + (extract(minute from p_starts_at at time zone 'Asia/Bangkok') / 60.0) >= 9.0
    and extract(hour from p_starts_at at time zone 'Asia/Bangkok') + (extract(minute from p_starts_at at time zone 'Asia/Bangkok') / 60.0) + p_hours <= 23.0
$$;

-- 4. Customer create_booking with 30-min increments and 5-min holds
create or replace function public.create_booking(p_court_id smallint, p_starts_at timestamptz, p_hours numeric)
returns public.bookings
language plpgsql security definer set search_path = public as $$
declare
  c_min_hours     constant numeric := 0.5;
  c_max_hours     constant numeric := 4.0;
  c_max_days      constant int := 14;
  c_hold_minutes  constant int := 5; -- 5-minute hold
  c_max_open      constant int := 3;
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

-- 5. Admin create_booking with 30-min increments
create or replace function public.admin_create_booking(
  p_court_id       smallint,
  p_starts_at      timestamptz,
  p_hours          numeric,
  p_channel        text,
  p_customer_name  text,
  p_customer_phone text default null,
  p_note           text default null
) returns public.bookings
language plpgsql security definer set search_path = public as $$
declare
  c_max_hours constant numeric := 14.0;
  c_max_days  constant int := 60;
  v_local timestamp := p_starts_at at time zone 'Asia/Bangkok';
  v_court courts;
  v_row   bookings;
begin
  if not is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if p_channel is null or p_channel not in ('phone', 'line', 'walk_in') then
    raise exception 'INVALID_CHANNEL' using errcode = '22023';
  end if;

  if nullif(trim(p_customer_name), '') is null then
    raise exception 'NAME_REQUIRED' using errcode = '22023';
  end if;

  if p_hours is null or p_hours < 0.5 or p_hours > c_max_hours or (p_hours * 2) <> round(p_hours * 2) then
    raise exception 'INVALID_DURATION' using errcode = '22023';
  end if;

  if p_starts_at is null
     or extract(minute from v_local) not in (0, 30)
     or extract(second from v_local) <> 0 then
    raise exception 'INVALID_START' using errcode = '22023';
  end if;

  if p_starts_at < now() - interval '1 hour' then
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

  begin
    insert into bookings (
      court_id, user_id, starts_at, ends_at, amount, status,
      channel, customer_name, customer_phone, admin_note
    ) values (
      p_court_id, auth.uid(), p_starts_at, p_starts_at + make_interval(mins => round(p_hours * 60)::int),
      round(v_court.price_per_hour * p_hours), 'confirmed',
      p_channel, trim(p_customer_name), nullif(trim(p_customer_phone), ''), nullif(trim(p_note), '')
    )
    returning * into v_row;
  exception when exclusion_violation then
    raise exception 'SLOT_TAKEN' using errcode = '23P01';
  end;

  return v_row;
end $$;

revoke execute on function public.admin_create_booking(smallint, timestamptz, numeric, text, text, text, text)
  from public, anon;
grant execute on function public.admin_create_booking(smallint, timestamptz, numeric, text, text, text, text)
  to authenticated;
