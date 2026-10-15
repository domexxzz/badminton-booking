-- Automatic slip verification (EasySlip). The server calls the provider with
-- the service-role key and records the outcome through record_slip_check(),
-- which customers cannot execute.
--
-- Only a clean "verified" result acts on its own (confirms the booking).
-- Everything else stays in awaiting_review for an admin with the reasons
-- attached, so a customer who really paid is never dropped automatically.

-- EasySlip accepts images up to 4MB.
update storage.buckets set file_size_limit = 4194304 where id = 'slips';

alter table public.payments
  add column verify_status  text not null default 'unchecked'
    check (verify_status in ('unchecked', 'verified', 'mismatch', 'duplicate', 'unreadable', 'error')),
  add column verify_reasons text[] not null default '{}',
  add column trans_ref      text,
  add column slip_amount    numeric(12, 2),
  add column slip_date      timestamptz,
  add column verify_raw     jsonb,
  add column verified_at    timestamptz;

-- One bank transaction can pay for one booking. Rejected payments release it.
create unique index payments_trans_ref_uniq on public.payments (trans_ref)
  where trans_ref is not null and status <> 'rejected';

create function public.record_slip_check(
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
  v_booking_id uuid;
  v_booking    bookings;
  v_pay        payments;
  v_status     text := p_status;
  v_reasons    text[] := coalesce(p_reasons, '{}');
begin
  if p_status not in ('verified', 'mismatch', 'unreadable', 'error') then
    raise exception 'INVALID_VERIFY_STATUS' using errcode = '22023';
  end if;

  -- Lock booking before payment, the same order review_payment() uses.
  select booking_id into v_booking_id from payments where id = p_payment_id;
  if not found then
    raise exception 'PAYMENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  select * into v_booking from bookings where id = v_booking_id for update;
  select * into v_pay from payments where id = p_payment_id for update;

  -- An admin (or a parallel check) already decided; never override that.
  if v_pay.status <> 'submitted' or v_booking.status <> 'awaiting_review' then
    return 'skipped';
  end if;

  -- Defence in depth: never auto-confirm an amount that differs from the booking.
  if v_status = 'verified' and (p_slip_amount is null or p_slip_amount <> v_booking.amount) then
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
      status      = case when v_status = 'verified' then 'approved' else status end,
      reviewed_at = case when v_status = 'verified' then now() else reviewed_at end
  where id = p_payment_id;

  if v_status = 'verified' then
    update bookings set status = 'confirmed', review_note = null where id = v_booking.id;
  end if;

  return v_status;
end $$;

revoke execute on function public.record_slip_check(uuid, text, text[], text, numeric, timestamptz, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_slip_check(uuid, text, text[], text, numeric, timestamptz, jsonb)
  to service_role;
