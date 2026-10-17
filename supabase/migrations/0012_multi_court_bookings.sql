-- 0012_multi_court_bookings.sql
-- Multi-court booking in a single bill:
-- 1. Adds group_id to public.bookings to link multiple court slots into a single bill.
-- 2. Adds create_multi_booking() RPC to atomically hold multiple courts.
-- 3. Updates submit_slip(), review_payment(), cancel_booking() and record_slip_check()
--    to handle group totals and synchronize status across all bookings in the group.

alter table public.bookings add column if not exists group_id uuid default gen_random_uuid();
update public.bookings set group_id = id where group_id is null;
alter table public.bookings alter column group_id set not null;
create index if not exists bookings_group_id_idx on public.bookings (group_id);

-- Atomically book multiple courts for the same time slot under a single group_id.
create or replace function public.create_multi_booking(
  p_court_ids smallint[],
  p_starts_at timestamptz,
  p_hours numeric
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
  v_local         timestamp := p_starts_at at time zone 'Asia/Bangkok';
  v_group_id      uuid := gen_random_uuid();
  v_lead_row      bookings;
  v_row           bookings;
  v_court         courts;
  v_court_id      smallint;
  v_num_courts    int;
  v_open_count    int;
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

  if p_court_ids is null or array_length(p_court_ids, 1) is null or array_length(p_court_ids, 1) < 1 then
    raise exception 'COURT_NOT_FOUND' using errcode = 'P0002';
  end if;

  v_num_courts := array_length(p_court_ids, 1);
  if (select count(distinct c) from unnest(p_court_ids) c) <> v_num_courts then
    raise exception 'INVALID_COURTS' using errcode = '22023';
  end if;

  perform expire_holds();

  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));

  if (select count(*) from bookings
      where user_id = v_uid and created_at > now() - interval '1 hour') + v_num_courts > c_max_per_hour then
    raise exception 'TOO_MANY_RECENT_BOOKINGS' using errcode = '22023';
  end if;

  select count(*) into v_open_count from bookings
  where user_id = v_uid and status in ('pending_payment', 'awaiting_review');

  if v_open_count + v_num_courts > c_max_open then
    raise exception 'TOO_MANY_HOLDS' using errcode = '22023';
  end if;

  foreach v_court_id in array p_court_ids loop
    select * into v_court from courts where id = v_court_id and is_active;
    if not found then
      raise exception 'COURT_NOT_FOUND' using errcode = 'P0002';
    end if;

    begin
      insert into bookings (
        court_id, user_id, starts_at, ends_at, amount, status, hold_expires_at, group_id
      )
      values (
        v_court_id, v_uid, p_starts_at, p_starts_at + make_interval(mins => round(p_hours * 60)::int),
        round(v_court.price_per_hour * p_hours), 'pending_payment',
        now() + make_interval(mins => c_hold_minutes),
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

-- Keep backward compatibility for single-court create_booking
create or replace function public.create_booking(p_court_id smallint, p_starts_at timestamptz, p_hours numeric)
returns public.bookings
language plpgsql security definer set search_path = public as $$
begin
  return create_multi_booking(array[p_court_id], p_starts_at, p_hours);
end $$;

-- submit_slip updates all bookings in the same group to awaiting_review and records the group amount
create or replace function public.submit_slip(p_booking_id uuid, p_slip_path text)
returns public.bookings
language plpgsql security definer set search_path = public as $$
declare
  c_max_attempts constant int := 3;
  v_uid uuid := auth.uid();
  v_row bookings;
  v_group_amount numeric(10, 2);
begin
  select * into v_row from bookings
  where id = p_booking_id and user_id = v_uid
  for update;
  if not found then
    raise exception 'BOOKING_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_row.status <> 'pending_payment' then
    raise exception '%', case when v_row.status = 'expired' then 'HOLD_EXPIRED' else 'INVALID_STATUS' end
      using errcode = '22023';
  end if;

  if p_slip_path !~ ('^' || v_uid::text || '/' || p_booking_id::text || '-[0-9]+\.(jpg|jpeg|png|webp)$')
     or not exists (select 1 from storage.objects where bucket_id = 'slips' and name = p_slip_path) then
    raise exception 'INVALID_SLIP' using errcode = '22023';
  end if;

  if (select count(*) from payments where booking_id = v_row.id and status = 'rejected') >= c_max_attempts then
    raise exception 'TOO_MANY_SLIP_ATTEMPTS' using errcode = '22023';
  end if;

  -- Total amount for this group of bookings
  select coalesce(sum(amount), v_row.amount) into v_group_amount
  from bookings where group_id = v_row.group_id;

  insert into payments (booking_id, user_id, amount, slip_path)
  values (v_row.id, v_uid, v_group_amount, p_slip_path);

  update bookings
  set status = 'awaiting_review', hold_expires_at = null, review_note = null
  where group_id = v_row.group_id;

  select * into v_row from bookings where id = p_booking_id;
  return v_row;
end $$;

-- review_payment updates all bookings in the same group
create or replace function public.review_payment(p_booking_id uuid, p_approve boolean, p_note text default null)
returns public.bookings
language plpgsql security definer set search_path = public as $$
declare
  c_hold_minutes constant int := 15;
  v_row bookings;
begin
  if not is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  select * into v_row from bookings where id = p_booking_id for update;
  if not found then
    raise exception 'BOOKING_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_row.status <> 'awaiting_review' then
    raise exception 'INVALID_STATUS' using errcode = '22023';
  end if;

  update payments
  set status = case when p_approve then 'approved' else 'rejected' end,
      reviewed_by = auth.uid(), reviewed_at = now()
  where id = (
    select id from payments
    where booking_id = p_booking_id and status = 'submitted'
    order by created_at desc limit 1
  );

  if p_approve then
    update bookings set status = 'confirmed', review_note = p_note
    where group_id = v_row.group_id;
  else
    update bookings
    set status = 'pending_payment',
        hold_expires_at = now() + make_interval(mins => c_hold_minutes),
        review_note = coalesce(nullif(trim(p_note), ''), 'สลิปไม่ถูกต้อง กรุณาอัปโหลดใหม่')
    where group_id = v_row.group_id;
  end if;

  select * into v_row from bookings where id = p_booking_id;
  return v_row;
end $$;

-- cancel_booking cancels all bookings in the same group
create or replace function public.cancel_booking(p_booking_id uuid)
returns public.bookings
language plpgsql security definer set search_path = public as $$
declare
  v_admin boolean := is_admin();
  v_row bookings;
begin
  select * into v_row from bookings
  where id = p_booking_id and (user_id = auth.uid() or v_admin)
  for update;
  if not found then
    raise exception 'BOOKING_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Customers may only drop an unpaid hold; paid bookings need an admin (refund).
  if not (v_row.status = 'pending_payment'
          or (v_admin and v_row.status in ('awaiting_review', 'confirmed'))) then
    raise exception 'INVALID_STATUS' using errcode = '22023';
  end if;

  update bookings set status = 'cancelled'
  where group_id = v_row.group_id;

  select * into v_row from bookings where id = p_booking_id;
  return v_row;
end $$;

-- record_slip_check checks against the group total amount and confirms all bookings in group
create or replace function public.record_slip_check(
  p_payment_id  uuid,
  p_status      text,
  p_reasons     text[],
  p_trans_ref   text default null,
  p_slip_amount numeric default null,
  p_slip_date   timestamptz default null,
  p_raw         jsonb default null
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_booking_id   uuid;
  v_booking      bookings;
  v_pay          payments;
  v_status       text := p_status;
  v_reasons      text[] := coalesce(p_reasons, '{}');
  v_group_amount numeric(10, 2);
begin
  if p_status not in ('verified', 'mismatch', 'unreadable', 'error') then
    raise exception 'INVALID_VERIFY_STATUS' using errcode = '22023';
  end if;

  select booking_id into v_booking_id from payments where id = p_payment_id;
  if not found then
    raise exception 'PAYMENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  select * into v_booking from bookings where id = v_booking_id for update;
  select * into v_pay from payments where id = p_payment_id for update;

  if v_pay.status <> 'submitted' or v_booking.status <> 'awaiting_review' then
    return 'skipped';
  end if;

  -- Calculate group total amount
  select coalesce(sum(amount), v_booking.amount) into v_group_amount
  from bookings where group_id = v_booking.group_id;

  -- Defence in depth: never auto-confirm an amount that differs from the total group amount.
  if v_status = 'verified' and (p_slip_amount is null or p_slip_amount <> v_group_amount) then
    v_status := 'mismatch';
    v_reasons := v_reasons || 'ยอดเงินในสลิปไม่ตรงกับยอดที่ต้องชำระ'::text;
  end if;

  if p_trans_ref is not null then
    begin
      update payments set trans_ref = p_trans_ref where id = p_payment_id;
    exception when unique_violation then
      v_status := 'duplicate';
      v_reasons := array['สลิปนี้ถูกใช้กับการจองอื่นแล้ว'];
    end;
  end if;

  update payments
  set verify_status  = v_status,
      verify_reasons = v_reasons,
      slip_amount    = p_slip_amount,
      slip_date      = p_slip_date,
      verify_raw     = p_raw,
      verified_at    = now(),
      status         = case when v_status = 'verified' then 'approved' else status end,
      reviewed_at    = case when v_status = 'verified' then now() else reviewed_at end
  where id = p_payment_id;

  if v_status = 'verified' then
    update bookings set status = 'confirmed', review_note = null
    where group_id = v_booking.group_id;
  end if;

  return v_status;
end $$;

-- Permissions
revoke execute on function public.create_multi_booking(smallint[], timestamptz, numeric) from public, anon;
grant execute on function public.create_multi_booking(smallint[], timestamptz, numeric) to authenticated;
