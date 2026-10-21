-- Allow a private bank-account description instead of a refund QR.
-- Existing QR requests and the three-argument RPC remain supported.
alter table public.booking_requests
  add column refund_account text check (char_length(refund_account) <= 300);

-- Replace only the original constraint requiring every cancellation to have a QR.
do $$
declare c record;
begin
  for c in select conname from pg_constraint
    where conrelid = 'public.booking_requests'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%refund_qr_path IS NOT NULL%'
      and pg_get_constraintdef(oid) like '%cancel%'
  loop
    execute format('alter table public.booking_requests drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.booking_requests add constraint booking_requests_refund_details_check
  check (kind <> 'cancel' or refund_qr_path is not null or coalesce(refund_account ~ '[^[:space:]]', false));

create or replace function public.request_cancel(p_booking_id uuid, p_qr_path text, p_reason text, p_refund_account text)
returns public.booking_requests
language plpgsql security definer set search_path = public as $$
declare
  v_row    bookings := lock_changeable_booking(p_booking_id);
  v_amount numeric(10, 2);
  v_req    booking_requests;
  v_account text := nullif(regexp_replace(p_refund_account, '^\s+|\s+$', '', 'g'), '');
begin
  if now() >= self_cancel_deadline(v_row.starts_at) then
    raise exception 'CANCEL_DEADLINE_PASSED' using errcode = '22023';
  end if;
  -- Nothing was paid, so there is nothing to refund: cancel_booking() handles it.
  if v_row.pay_later and v_row.paid_at is null then
    raise exception 'NO_REFUND_NEEDED' using errcode = '22023';
  end if;
  if char_length(v_account) > 300 then
    raise exception 'INVALID_REFUND_ACCOUNT' using errcode = '22023';
  end if;
  if p_qr_path is null and v_account is null then
    raise exception 'REFUND_DETAILS_REQUIRED' using errcode = '22023';
  end if;
  if p_qr_path is not null and (p_qr_path !~ ('^' || v_row.user_id::text || '/' || v_row.id::text || '-qr-[0-9]+\.(jpg|jpeg|png|webp)$')
     or not exists (select 1 from storage.objects where bucket_id = 'refunds' and name = p_qr_path)) then
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

  insert into booking_requests (booking_id, user_id, kind, status, reason, refund_qr_path, refund_amount, refund_account)
  values (
    v_row.id, v_row.user_id, 'cancel', 'refund_pending',
    nullif(left(trim(coalesce(p_reason, '')), 300), ''), p_qr_path, v_amount, v_account
  )
  returning * into v_req;
  return v_req;
end $$;

-- Keep callers using the old QR-only signature working.
create or replace function public.request_cancel(p_booking_id uuid, p_qr_path text, p_reason text default null)
returns public.booking_requests
language plpgsql security definer set search_path = public as $$
begin
  return public.request_cancel(p_booking_id, p_qr_path, p_reason, null);
end $$;

revoke execute on function public.request_cancel(uuid, text, text, text) from public, anon;
grant execute on function public.request_cancel(uuid, text, text, text) to authenticated;

notify pgrst, 'reload schema';
