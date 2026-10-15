-- Bookings taken by phone, LINE or at the counter. Most of the shop's
-- customers book this way, so these must block the live board exactly like
-- online bookings do. The admin vouches for them: they are confirmed at once
-- at the base price (no satang) and paid at the counter. The channel and
-- customer columns live on public.bookings (0001).

create function public.admin_create_booking(
  p_court_id       smallint,
  p_starts_at      timestamptz,
  p_hours          int,
  p_channel        text,
  p_customer_name  text,
  p_customer_phone text default null,
  p_note           text default null
) returns public.bookings
language plpgsql security definer set search_path = public as $$
declare
  c_max_hours constant int := 14; -- a whole day, for regulars booking long sessions
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
  if p_hours is null or p_hours < 1 or p_hours > c_max_hours then
    raise exception 'INVALID_DURATION' using errcode = '22023';
  end if;
  if p_starts_at is null or date_trunc('hour', v_local) <> v_local then
    raise exception 'INVALID_START' using errcode = '22023';
  end if;
  -- A walk-in may take the court for the hour that is already running.
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
      p_court_id, auth.uid(), p_starts_at, p_starts_at + make_interval(hours => p_hours),
      v_court.price_per_hour * p_hours, 'confirmed',
      p_channel, trim(p_customer_name), nullif(trim(p_customer_phone), ''), nullif(trim(p_note), '')
    )
    returning * into v_row;
  exception when exclusion_violation then
    raise exception 'SLOT_TAKEN' using errcode = '23P01';
  end;

  return v_row;
end $$;

revoke execute on function public.admin_create_booking(smallint, timestamptz, int, text, text, text, text)
  from public, anon;
grant execute on function public.admin_create_booking(smallint, timestamptz, int, text, text, text, text)
  to authenticated;
