-- Confirm bookings from incoming-transfer notifications that the shop's phone
-- forwards (MacroDroid -> POST /api/bank-notifications). Every booking has a
-- unique satang amount, so "เงินเข้า 300.37" identifies exactly one booking.
-- Written only by the server with the service-role key.

alter table public.payments alter column slip_path drop not null;
alter table public.payments
  add column source text not null default 'slip' check (source in ('slip', 'bank_notification')),
  add constraint payments_slip_path_required check (source <> 'slip' or slip_path is not null);

create table public.bank_notifications (
  id          uuid primary key default gen_random_uuid(),
  dedupe_key  text        not null unique,
  received_at timestamptz not null default now(),
  posted_at   timestamptz,
  source_app  text        not null,
  title       text,
  body        text        not null,
  direction   text        not null check (direction in ('in', 'out', 'unknown')),
  amount      numeric(12, 2),
  outcome     text        not null check (outcome in ('matched', 'unmatched', 'ignored')),
  booking_id  uuid references public.bookings on delete set null,
  note        text,
  handled_at  timestamptz,
  handled_by  uuid references auth.users
);

create index bank_notifications_inbox_idx on public.bank_notifications (received_at desc)
  where outcome = 'unmatched' and handled_at is null;

-- When the phone last talked to us (any notification or heartbeat).
create table public.bank_listener_status (
  id           boolean primary key default true check (id),
  last_seen_at timestamptz
);
insert into public.bank_listener_status (id) values (true);

create function public.record_listener_heartbeat() returns void
language sql security definer set search_path = public as $$
  update bank_listener_status set last_seen_at = now() where id
$$;

create function public.record_bank_notification(
  p_dedupe_key text,
  p_source_app text,
  p_title      text,
  p_body       text,
  p_direction  text,
  p_amount     numeric,
  p_posted_at  timestamptz default null,
  p_review_reason text default null -- set by the server when something looks off: never auto-match
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c_skew      constant interval := interval '5 minutes';
  v_id        uuid;
  v_paid_at   timestamptz := coalesce(p_posted_at, now());
  v_booking   bookings;
  v_candidate bookings;
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

  -- Money came in but we can't be sure how much or when: a human must look.
  if p_amount is null or p_review_reason is not null then
    update bank_notifications
    set outcome = 'unmatched',
        note = coalesce(p_review_reason, 'อ่านยอดเงินในแจ้งเตือนไม่ได้ ตรวจสอบในแอปธนาคาร')
    where id = v_id;
    return jsonb_build_object('outcome', 'unmatched');
  end if;

  -- At most one open booking has this exact amount (bookings_open_amount_uniq).
  select * into v_booking from bookings
  where amount = p_amount
    and status in ('pending_payment', 'awaiting_review')
    and created_at <= v_paid_at + c_skew
  for update;

  if found then
    update payments set status = 'approved', reviewed_at = now()
    where booking_id = v_booking.id and status = 'submitted';
    insert into payments (booking_id, user_id, amount, source, status, reviewed_at, verify_status)
    values (v_booking.id, v_booking.user_id, p_amount, 'bank_notification', 'approved', now(), 'verified');
    update bookings set status = 'confirmed', hold_expires_at = null, review_note = null
    where id = v_booking.id;
    update bank_notifications set outcome = 'matched', booking_id = v_booking.id where id = v_id;
    return jsonb_build_object('outcome', 'matched', 'booking_id', v_booking.id);
  end if;

  -- No open booking wants this money. Point the admin at the likely owner.
  -- Only online bookings carry unique amounts; a phone booking's 130.00 says nothing.
  select * into v_candidate from bookings
  where amount = p_amount and channel = 'online' and updated_at > now() - interval '24 hours'
  order by updated_at desc
  limit 1;

  -- Already confirmed from a slip and this is that same transfer arriving: reconcile.
  if v_candidate.status = 'confirmed'
     and not exists (select 1 from bank_notifications where booking_id = v_candidate.id and outcome = 'matched') then
    update bank_notifications
    set outcome = 'matched', booking_id = v_candidate.id, note = 'ยืนยันจากสลิปไปก่อนแล้ว เงินเข้าตรงยอด'
    where id = v_id;
    return jsonb_build_object('outcome', 'matched', 'booking_id', v_candidate.id, 'reconciled', true);
  end if;

  update bank_notifications
  set outcome = 'unmatched',
      booking_id = v_candidate.id,
      note = case
        when v_candidate.id is null then 'ไม่พบการจองที่ยอดตรง'
        when v_candidate.status = 'confirmed' then 'ยอดตรงกับการจองที่ยืนยันแล้ว ลูกค้าอาจโอนซ้ำ'
        when v_candidate.status in ('pending_payment', 'awaiting_review')
          then 'ยอดตรงกับการจองที่รอชำระ แต่เวลาโอนอยู่ก่อนเวลาจอง ตรวจสอบก่อนยืนยัน'
        else 'ยอดตรงกับการจองที่หมดเวลาหรือยกเลิกแล้ว ติดต่อลูกค้า'
      end
  where id = v_id;
  return jsonb_build_object('outcome', 'unmatched');
end $$;

create function public.mark_bank_notification_handled(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  update bank_notifications set handled_at = now(), handled_by = auth.uid()
  where id = p_id and handled_at is null;
end $$;

revoke execute on function public.record_listener_heartbeat() from public, anon, authenticated;
revoke execute on function public.record_bank_notification(text, text, text, text, text, numeric, timestamptz, text)
  from public, anon, authenticated;
revoke execute on function public.mark_bank_notification_handled(uuid) from public, anon;
grant execute on function public.record_listener_heartbeat() to service_role;
grant execute on function public.record_bank_notification(text, text, text, text, text, numeric, timestamptz, text)
  to service_role;
grant execute on function public.mark_bank_notification_handled(uuid) to authenticated;

alter table public.bank_notifications   enable row level security;
alter table public.bank_listener_status enable row level security;

create policy "admins read bank notifications" on public.bank_notifications
  for select to authenticated using (public.is_admin());
create policy "admins read listener status" on public.bank_listener_status
  for select to authenticated using (public.is_admin());

alter publication supabase_realtime add table public.bank_notifications;
