-- 0017_multi_slot_bookings.sql
-- Allows booking multiple courts with individual start times and durations
-- in a single bill (shared group_id), for both customers/coaches and admins.

create or replace function public.create_cart_booking(
  p_items     jsonb,
  p_pay_later boolean default false,
  p_total     numeric default null
)
returns public.bookings
language plpgsql security definer set search_path = public as $$
declare
  c_min_hours     constant numeric := 0.5;
  c_max_hours     constant numeric := 4.0;
  c_max_days      constant int := 14;
  c_hold_minutes  constant int := 5;
  c_max_open      constant int := 4;
  c_max_per_hour  constant int := 6;
  v_uid           uuid := auth.uid();
  v_is_coach      boolean := false;
  v_group_id      uuid := gen_random_uuid();
  v_lead_row      bookings;
  v_row           bookings;
  v_court         courts;
  v_item          jsonb;
  v_court_id      smallint;
  v_starts_at     timestamptz;
  v_hours         numeric;
  v_local         timestamp;
  v_num_items     int;
  v_open_count    int;
  v_list          numeric(10, 2);
  v_i             int := 0;
  v_left          numeric(10, 2);
  v_share         numeric(10, 2);
  r               record;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 then
    raise exception 'COURT_NOT_FOUND' using errcode = 'P0002';
  end if;

  v_num_items := jsonb_array_length(p_items);
  if v_num_items > c_max_open then
    raise exception 'TOO_MANY_HOLDS' using errcode = '22023';
  end if;

  if p_pay_later or p_total is not null then
    v_is_coach := coalesce((select is_coach from profiles where id = v_uid), false);
    if not v_is_coach then
      raise exception 'NOT_COACH' using errcode = '42501';
    end if;
  end if;

  perform expire_holds();
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));

  if (select count(*) from bookings
      where user_id = v_uid and created_at > now() - interval '1 hour') + v_num_items > c_max_per_hour then
    raise exception 'TOO_MANY_RECENT_BOOKINGS' using errcode = '22023';
  end if;

  select count(*) into v_open_count from bookings
  where user_id = v_uid and status in ('pending_payment', 'awaiting_review');

  if v_open_count + v_num_items > c_max_open then
    raise exception 'TOO_MANY_HOLDS' using errcode = '22023';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_court_id  := (v_item->>'court_id')::smallint;
    v_starts_at := (v_item->>'starts_at')::timestamptz;
    v_hours     := (v_item->>'hours')::numeric;
    v_local     := v_starts_at at time zone 'Asia/Bangkok';

    if v_hours is null or v_hours < c_min_hours or v_hours > c_max_hours or (v_hours * 2) <> round(v_hours * 2) then
      raise exception 'INVALID_DURATION' using errcode = '22023';
    end if;

    if v_starts_at is null
       or extract(minute from v_local) not in (0, 30)
       or extract(second from v_local) <> 0 then
      raise exception 'INVALID_START' using errcode = '22023';
    end if;

    if v_starts_at <= now() then
      raise exception 'START_IN_PAST' using errcode = '22023';
    end if;

    if v_starts_at > now() + make_interval(days => c_max_days) then
      raise exception 'TOO_FAR_AHEAD' using errcode = '22023';
    end if;

    if not opening_hours_ok(v_starts_at, v_hours) then
      raise exception 'OUTSIDE_OPENING_HOURS' using errcode = '22023';
    end if;

    select * into v_court from courts where id = v_court_id and is_active;
    if not found then
      raise exception 'COURT_NOT_FOUND' using errcode = 'P0002';
    end if;

    begin
      insert into bookings (
        court_id, user_id, starts_at, ends_at, amount, status, hold_expires_at, group_id, pay_later
      )
      values (
        v_court_id,
        v_uid,
        v_starts_at,
        v_starts_at + make_interval(mins => round(v_hours * 60)::int),
        round(v_court.price_per_hour * v_hours),
        case when p_pay_later then 'confirmed'::booking_status else 'pending_payment'::booking_status end,
        case when p_pay_later then null else now() + make_interval(mins => c_hold_minutes) end,
        v_group_id,
        coalesce(p_pay_later, false)
      )
      returning * into v_row;

      if v_lead_row.id is null then
        v_lead_row := v_row;
      end if;
    exception when exclusion_violation then
      raise exception 'SLOT_TAKEN' using errcode = '23P01';
    end;
  end loop;

  if p_total is not null then
    select sum(amount) into v_list from bookings where group_id = v_group_id;
    if p_total <> v_list then
      if p_total <> round(p_total) or p_total < v_num_items or p_total > v_list then
        raise exception 'INVALID_AMOUNT' using errcode = '22023';
      end if;
      v_left := p_total;
      for r in select id, amount from bookings where group_id = v_group_id order by court_id, starts_at loop
        v_i := v_i + 1;
        v_share := case when v_i = v_num_items then v_left else floor(p_total * r.amount / v_list) end;
        update bookings set list_amount = r.amount, amount = v_share where id = r.id;
        v_left := v_left - v_share;
      end loop;
    end if;
  end if;

  select * into v_lead_row from bookings where id = v_lead_row.id;
  return v_lead_row;
end $$;

create or replace function public.admin_create_cart_booking(
  p_items          jsonb,
  -- bookings.channel is plain text with a check constraint (0001), not an enum.
  p_channel        text,
  p_customer_name  text,
  p_customer_phone text default null,
  p_note           text default null
)
returns public.bookings
language plpgsql security definer set search_path = public as $$
declare
  v_uid       uuid := auth.uid();
  v_group_id  uuid := gen_random_uuid();
  v_lead_row  bookings;
  v_row       bookings;
  v_court     courts;
  v_item      jsonb;
  v_court_id  smallint;
  v_starts_at timestamptz;
  v_hours     numeric;
  v_local     timestamp;
begin
  if not is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if p_channel not in ('phone', 'line', 'walk_in')
     or p_customer_name is null or length(trim(p_customer_name)) = 0 then
    raise exception 'INVALID_CUSTOMER' using errcode = '22023';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 then
    raise exception 'COURT_NOT_FOUND' using errcode = 'P0002';
  end if;

  perform expire_holds();

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_court_id  := (v_item->>'court_id')::smallint;
    v_starts_at := (v_item->>'starts_at')::timestamptz;
    v_hours     := (v_item->>'hours')::numeric;
    v_local     := v_starts_at at time zone 'Asia/Bangkok';

    if v_hours is null or v_hours < 0.5 or v_hours > 14 or (v_hours * 2) <> round(v_hours * 2) then
      raise exception 'INVALID_DURATION' using errcode = '22023';
    end if;

    if v_starts_at is null
       or extract(minute from v_local) not in (0, 30)
       or extract(second from v_local) <> 0 then
      raise exception 'INVALID_START' using errcode = '22023';
    end if;

    if not opening_hours_ok(v_starts_at, v_hours) then
      raise exception 'OUTSIDE_OPENING_HOURS' using errcode = '22023';
    end if;

    select * into v_court from courts where id = v_court_id and is_active;
    if not found then
      raise exception 'COURT_NOT_FOUND' using errcode = 'P0002';
    end if;

    begin
      insert into bookings (
        court_id, user_id, starts_at, ends_at, amount, status,
        channel, customer_name, customer_phone, admin_note, created_by, group_id
      )
      values (
        v_court_id, v_uid, v_starts_at,
        v_starts_at + make_interval(mins => round(v_hours * 60)::int),
        round(v_court.price_per_hour * v_hours), 'confirmed',
        p_channel, left(trim(p_customer_name), 100),
        nullif(left(trim(coalesce(p_customer_phone, '')), 20), ''),
        nullif(left(trim(coalesce(p_note, '')), 300), ''),
        v_uid, v_group_id
      )
      returning * into v_row;

      if v_lead_row.id is null then
        v_lead_row := v_row;
      end if;
    exception when exclusion_violation then
      raise exception 'SLOT_TAKEN' using errcode = '23P01';
    end;
  end loop;

  return v_lead_row;
end $$;

revoke execute on function public.create_cart_booking(jsonb, boolean, numeric) from public, anon;
revoke execute on function public.admin_create_cart_booking(jsonb, text, text, text, text) from public, anon;
grant execute on function public.create_cart_booking(jsonb, boolean, numeric) to authenticated;
grant execute on function public.admin_create_cart_booking(jsonb, text, text, text, text) to authenticated;
