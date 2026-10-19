-- Coach accounts (granted by an admin) can book on special terms:
--   * pay later: the booking is confirmed at once and the shop collects later
--     (an admin marks it paid);
--   * an agreed price: the coach enters the bill total, never above list price.
-- Everyone else still pays straight away at list price.

alter table public.profiles add column if not exists is_coach boolean not null default false;
-- Customers keep update rights on display_name and phone only (0001), so they
-- cannot make themselves coaches.

alter table public.bookings
  add column if not exists pay_later   boolean not null default false,
  add column if not exists paid_at     timestamptz,
  add column if not exists list_amount numeric(10, 2); -- list price when a coach agreed a different one

create index if not exists bookings_unpaid_idx on public.bookings (starts_at)
  where pay_later and paid_at is null and status = 'confirmed';

create or replace function public.set_coach(p_user_id uuid, p_is_coach boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  update profiles set is_coach = p_is_coach where id = p_user_id;
  if not found then
    raise exception 'USER_NOT_FOUND' using errcode = 'P0002';
  end if;
end $$;

-- Same checks and holds as create_multi_booking(), then the coach's terms.
create or replace function public.create_coach_booking(
  p_court_ids smallint[],
  p_starts_at timestamptz,
  p_hours     numeric,
  p_pay_later boolean,
  p_total     numeric default null
) returns public.bookings
language plpgsql security definer set search_path = public as $$
declare
  v_lead  bookings;
  v_list  numeric(10, 2);
  v_n     int;
  v_i     int := 0;
  v_left  numeric(10, 2);
  v_share numeric(10, 2);
  r       record;
begin
  if not coalesce((select is_coach from profiles where id = auth.uid()), false) then
    raise exception 'NOT_COACH' using errcode = '42501';
  end if;

  v_lead := create_multi_booking(p_court_ids, p_starts_at, p_hours);
  select sum(amount), count(*) into v_list, v_n from bookings where group_id = v_lead.group_id;

  if p_total is not null and p_total <> v_list then
    -- Whole baht, at least ฿1 per court, never above list price.
    if p_total <> round(p_total) or p_total < v_n or p_total > v_list then
      raise exception 'INVALID_AMOUNT' using errcode = '22023';
    end if;
    -- Spread the agreed total over the courts; the last one takes the rounding.
    v_left := p_total;
    for r in select id, amount from bookings where group_id = v_lead.group_id order by court_id loop
      v_i := v_i + 1;
      v_share := case when v_i = v_n then v_left else floor(p_total * r.amount / v_list) end;
      update bookings set list_amount = r.amount, amount = v_share where id = r.id;
      v_left := v_left - v_share;
    end loop;
  end if;

  if p_pay_later then
    update bookings set status = 'confirmed', pay_later = true, hold_expires_at = null
    where group_id = v_lead.group_id;
  end if;

  select * into v_lead from bookings where id = v_lead.id;
  return v_lead;
end $$;

-- Admin: the shop received the money for a pay-later bill.
create or replace function public.mark_booking_paid(p_booking_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  update bookings set paid_at = now()
  where group_id = (select group_id from bookings where id = p_booking_id)
    and pay_later and paid_at is null;
  if not found then
    raise exception 'BOOKING_NOT_FOUND' using errcode = 'P0002';
  end if;
end $$;

-- Customers may drop an unpaid hold, or an unpaid pay-later bill before the
-- self-cancel deadline; paid bookings go through request_cancel() (refund).
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

  if not (
    v_row.status = 'pending_payment'
    or (v_admin and v_row.status in ('awaiting_review', 'confirmed'))
    or (v_row.status = 'confirmed' and v_row.pay_later and v_row.paid_at is null)
  ) then
    raise exception 'INVALID_STATUS' using errcode = '22023';
  end if;
  if not v_admin and v_row.status = 'confirmed' and now() >= self_cancel_deadline(v_row.starts_at) then
    raise exception 'CANCEL_DEADLINE_PASSED' using errcode = '22023';
  end if;

  update bookings set status = 'cancelled'
  where group_id = v_row.group_id;

  select * into v_row from bookings where id = p_booking_id;
  return v_row;
end $$;

create or replace function public.request_cancel(p_booking_id uuid, p_qr_path text, p_reason text default null)
returns public.booking_requests
language plpgsql security definer set search_path = public as $$
declare
  v_row    bookings := lock_changeable_booking(p_booking_id);
  v_amount numeric(10, 2);
  v_req    booking_requests;
begin
  if now() >= self_cancel_deadline(v_row.starts_at) then
    raise exception 'CANCEL_DEADLINE_PASSED' using errcode = '22023';
  end if;
  -- Nothing was paid, so there is nothing to refund: cancel_booking() handles it.
  if v_row.pay_later and v_row.paid_at is null then
    raise exception 'NO_REFUND_NEEDED' using errcode = '22023';
  end if;
  if p_qr_path is null
     or p_qr_path !~ ('^' || v_row.user_id::text || '/' || v_row.id::text || '-qr-[0-9]+\.(jpg|jpeg|png|webp)$')
     or not exists (select 1 from storage.objects where bucket_id = 'refunds' and name = p_qr_path) then
    raise exception 'INVALID_QR' using errcode = '22023';
  end if;

  -- One bill, one cancel: every paid court booked together goes.
  with cancelled as (
    update bookings set status = 'cancelled'
    where group_id = v_row.group_id and user_id = v_row.user_id and status = 'confirmed'
    returning amount
  )
  select coalesce(sum(amount), 0) into v_amount from cancelled;

  -- Requests on the other courts of the bill no longer apply.
  update booking_requests set status = 'withdrawn', resolved_at = now()
  where status = 'pending'
    and booking_id in (select id from bookings where group_id = v_row.group_id);

  insert into booking_requests (booking_id, user_id, kind, status, reason, refund_qr_path, refund_amount)
  values (
    v_row.id, v_row.user_id, 'cancel', 'refund_pending',
    nullif(left(trim(coalesce(p_reason, '')), 300), ''), p_qr_path, v_amount
  )
  returning * into v_req;
  return v_req;
end $$;

revoke execute on function public.set_coach(uuid, boolean) from public, anon;
revoke execute on function public.create_coach_booking(smallint[], timestamptz, numeric, boolean, numeric) from public, anon;
revoke execute on function public.mark_booking_paid(uuid) from public, anon;
grant execute on function public.set_coach(uuid, boolean) to authenticated;
grant execute on function public.create_coach_booking(smallint[], timestamptz, numeric, boolean, numeric) to authenticated;
grant execute on function public.mark_booking_paid(uuid) to authenticated;
