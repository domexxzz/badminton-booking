-- Online bookings cost the plain court price (130.00, not 130.37).
--
-- The satang suffix was what tied a transfer to one booking. Without it an
-- amount can't say whose money it is (a ฿130 transfer may just as well be a
-- walk-in paying at the counter), so incoming-transfer notifications no longer
-- confirm anything on their own: they land in the admin inbox with the open
-- bookings they could belong to, and the customer's slip is what gets checked.
-- Slip checks still refuse to auto-confirm an amount that differs from the booking.

drop index if exists public.bookings_open_amount_uniq;

create or replace function public.create_booking(p_court_id smallint, p_starts_at timestamptz, p_hours int)
returns public.bookings
language plpgsql security definer set search_path = public as $$
declare
  c_max_hours     constant int := 4;
  c_max_days      constant int := 14;
  c_hold_minutes  constant int := 15;
  c_max_open      constant int := 3; -- unconfirmed bookings (unpaid or slip under review) per user
  c_max_per_hour  constant int := 6; -- bookings created per user per hour, any outcome
  v_uid    uuid := auth.uid();
  v_local  timestamp := p_starts_at at time zone 'Asia/Bangkok';
  v_court  courts;
  v_row    bookings;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;
  if p_hours is null or p_hours < 1 or p_hours > c_max_hours then
    raise exception 'INVALID_DURATION' using errcode = '22023';
  end if;
  if p_starts_at is null or date_trunc('hour', v_local) <> v_local then
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

  perform expire_holds(); -- free stale holds before checking for overlap

  -- Serialize per user so parallel calls cannot all pass the hold-count check.
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));

  -- Create/cancel churn would keep courts flickering between held and free.
  if (select count(*) from bookings
      where user_id = v_uid and created_at > now() - interval '1 hour') >= c_max_per_hour then
    raise exception 'TOO_MANY_RECENT_BOOKINGS' using errcode = '22023';
  end if;

  -- Slips under review count too, or junk uploads could squat courts until an admin acts.
  if (select count(*) from bookings
      where user_id = v_uid and status in ('pending_payment', 'awaiting_review')) >= c_max_open then
    raise exception 'TOO_MANY_HOLDS' using errcode = '22023';
  end if;

  begin
    insert into bookings (court_id, user_id, starts_at, ends_at, amount, status, hold_expires_at)
    values (
      p_court_id, v_uid, p_starts_at, p_starts_at + make_interval(hours => p_hours),
      v_court.price_per_hour * p_hours, 'pending_payment',
      now() + make_interval(mins => c_hold_minutes)
    )
    returning * into v_row;
  exception when exclusion_violation then
    raise exception 'SLOT_TAKEN' using errcode = '23P01';
  end;

  return v_row;
end $$;

drop function if exists public.pick_booking_amount(numeric);

create or replace function public.record_bank_notification(
  p_dedupe_key text,
  p_source_app text,
  p_title      text,
  p_body       text,
  p_direction  text,
  p_amount     numeric,
  p_posted_at  timestamptz default null,
  p_review_reason text default null -- set by the server when something looks off
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c_skew    constant interval := interval '5 minutes';
  v_id      uuid;
  v_paid_at timestamptz := coalesce(p_posted_at, now());
  v_open    int;
  v_only    uuid;
begin
  perform record_listener_heartbeat();

  insert into bank_notifications (dedupe_key, posted_at, source_app, title, body, direction, amount, outcome)
  values (p_dedupe_key, p_posted_at, p_source_app, p_title, p_body, p_direction, p_amount, 'ignored')
  on conflict (dedupe_key) do nothing
  returning id into v_id;
  if v_id is null then
    return jsonb_build_object('outcome', 'duplicate');
  end if;

  if p_direction <> 'in' then
    update bank_notifications set note = 'ไม่ใช่รายการเงินเข้า' where id = v_id;
    return jsonb_build_object('outcome', 'ignored');
  end if;

  if p_amount is null or p_review_reason is not null then
    update bank_notifications
    set outcome = 'unmatched',
        note = coalesce(p_review_reason, 'อ่านยอดเงินในแจ้งเตือนไม่ได้ ตรวจสอบในแอปธนาคาร')
    where id = v_id;
    return jsonb_build_object('outcome', 'unmatched');
  end if;

  -- Point the admin at the online bookings this money could be for.
  select count(*), (array_agg(id))[1] into v_open, v_only
  from bookings
  where amount = p_amount
    and channel = 'online'
    and status in ('pending_payment', 'awaiting_review')
    and created_at <= v_paid_at + c_skew;

  update bank_notifications
  set outcome = 'unmatched',
      booking_id = case when v_open = 1 then v_only end,
      note = case
        when v_open = 0 then 'ไม่มีการจองออนไลน์ที่รอชำระยอดนี้ อาจเป็นลูกค้าหน้าร้านหรือโทรจอง'
        else format('ยอดตรงกับการจองที่รอชำระ %s รายการ ตรวจสลิปก่อนยืนยัน', v_open)
      end
  where id = v_id;
  return jsonb_build_object('outcome', 'unmatched');
end $$;
