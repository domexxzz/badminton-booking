-- Customers cancel a paid booking themselves, until 12:00 on the day they play.
--
-- Before the deadline: the booking (and every court on the same bill) is
-- cancelled at once, the courts free up, and the request waits as
-- 'refund_pending' until an admin transfers the money back to the customer's
-- QR and attaches the refund slip. After the deadline the customer cannot cancel.
-- A booking that starts before noon can be cancelled until it starts.

alter table public.booking_requests drop constraint if exists booking_requests_status_check;
alter table public.booking_requests add constraint booking_requests_status_check
  check (status in ('pending', 'approved', 'rejected', 'withdrawn', 'refund_pending'));
alter table public.booking_requests add column if not exists refund_amount numeric(10, 2);

create index if not exists booking_requests_refund_idx on public.booking_requests (created_at)
  where status = 'refund_pending';

-- Keep in sync with src/lib/cancel-policy.ts (SELF_CANCEL_HOUR).
create or replace function public.self_cancel_deadline(p_starts_at timestamptz) returns timestamptz
language sql stable as $$
  select least(
    p_starts_at,
    ((p_starts_at at time zone 'Asia/Bangkok')::date + time '12:00') at time zone 'Asia/Bangkok'
  )
$$;

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

-- Admin: approve/reject a pending request, or record the refund of a self-cancel.
create or replace function public.resolve_request(
  p_request_id       uuid,
  p_approve          boolean,
  p_note             text default null,
  p_refund_slip_path text default null
) returns public.booking_requests
language plpgsql security definer set search_path = public as $$
declare
  v_req     booking_requests;
  v_booking bookings;
  v_bid     uuid;
  v_note    text := nullif(left(trim(coalesce(p_note, '')), 300), '');
begin
  if not is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  -- Booking before request, the order the customer RPCs take them in.
  select booking_id into v_bid from booking_requests where id = p_request_id;
  if not found then
    raise exception 'REQUEST_NOT_FOUND' using errcode = 'P0002';
  end if;
  select * into v_booking from bookings where id = v_bid for update;
  select * into v_req from booking_requests where id = p_request_id for update;

  -- Cancel needs the refund slip whenever it is approved.
  if p_approve and v_req.kind = 'cancel' and (
       p_refund_slip_path is null
       or p_refund_slip_path !~ ('^' || v_booking.user_id::text || '/' || v_booking.id::text || '-refund-[0-9]+\.(jpg|jpeg|png|webp)$')
       or not exists (select 1 from storage.objects where bucket_id = 'refunds' and name = p_refund_slip_path)) then
    raise exception 'REFUND_SLIP_REQUIRED' using errcode = '22023';
  end if;

  if v_req.status = 'refund_pending' then
    -- The booking is already cancelled; the only step left is the refund.
    if not p_approve then
      raise exception 'INVALID_STATUS' using errcode = '22023';
    end if;
  elsif v_req.status <> 'pending' then
    raise exception 'REQUEST_NOT_FOUND' using errcode = 'P0002';
  elsif p_approve then
    if v_booking.status <> 'confirmed' then
      raise exception 'INVALID_STATUS' using errcode = '22023';
    end if;
    if v_req.kind = 'reschedule' then
      begin
        update bookings
        set court_id = v_req.new_court_id, starts_at = v_req.new_starts_at, ends_at = v_req.new_ends_at
        where id = v_booking.id;
      exception when exclusion_violation then
        raise exception 'SLOT_TAKEN' using errcode = '23P01';
      end;
    else
      update bookings set status = 'cancelled'
      where group_id = v_booking.group_id and status = 'confirmed';
    end if;
  end if;

  update booking_requests
  set status = case when p_approve then 'approved' else 'rejected' end,
      admin_note = v_note,
      refund_slip_path = case when p_approve and kind = 'cancel' then p_refund_slip_path end,
      resolved_at = now(),
      resolved_by = auth.uid()
  where id = p_request_id
  returning * into v_req;
  return v_req;
end $$;
