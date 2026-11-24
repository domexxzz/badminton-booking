-- 0038_fix_admin_cart_booking.sql
--
-- admin_create_cart_booking() (0017) writes to bookings.created_by, a column bookings has
-- never had, so an admin could not enter several courts as one bill: every attempt failed.
-- The admin is already recorded in user_id, as admin_create_booking() does, so the column
-- is dropped from the insert. Nothing else in the function changes.

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
        channel, customer_name, customer_phone, admin_note, group_id
      )
      values (
        v_court_id, v_uid, v_starts_at,
        v_starts_at + make_interval(mins => round(v_hours * 60)::int),
        round(v_court.price_per_hour * v_hours), 'confirmed',
        p_channel, left(trim(p_customer_name), 100),
        nullif(left(trim(coalesce(p_customer_phone, '')), 20), ''),
        nullif(left(trim(coalesce(p_note, '')), 300), ''),
        v_group_id
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

revoke execute on function public.admin_create_cart_booking(jsonb, text, text, text, text) from public, anon;
grant execute on function public.admin_create_cart_booking(jsonb, text, text, text, text) to authenticated;

notify pgrst, 'reload schema';
