-- Customers ask to move or cancel a paid booking; an admin decides.
--
-- Reschedule: same court length, any court, new start. The new slot is checked
-- when the customer asks and again when the admin approves (the exclusion
-- constraint has the final word).
-- Cancel: the customer attaches their own receive-money QR; the admin refunds
-- to it and attaches the refund slip, which the customer then sees.

create table public.booking_requests (
  id               uuid primary key default gen_random_uuid(),
  booking_id       uuid        not null references public.bookings on delete cascade,
  user_id          uuid        not null references auth.users on delete cascade,
  kind             text        not null check (kind in ('reschedule', 'cancel')),
  status           text        not null default 'pending'
                   check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  new_court_id     smallint    references public.courts,
  new_starts_at    timestamptz,
  new_ends_at      timestamptz,
  reason           text        check (char_length(reason) <= 300),
  refund_qr_path   text,
  refund_slip_path text,
  admin_note       text        check (char_length(admin_note) <= 300),
  created_at       timestamptz not null default now(),
  resolved_at      timestamptz,
  resolved_by      uuid references auth.users,
  check (kind <> 'reschedule' or (new_court_id is not null and new_starts_at is not null and new_ends_at > new_starts_at)),
  check (kind <> 'cancel' or refund_qr_path is not null)
);

-- One open request per booking.
create unique index booking_requests_one_pending on public.booking_requests (booking_id) where status = 'pending';
create index booking_requests_status_idx on public.booking_requests (status, created_at);

alter table public.booking_requests enable row level security;
create policy "read own requests or admin" on public.booking_requests
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

alter publication supabase_realtime add table public.booking_requests;

-- Moving a booking must move its row on the public board too.
create or replace function public.sync_occupancy() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('pending_payment', 'awaiting_review', 'confirmed') then
    insert into court_occupancy (booking_id, court_id, starts_at, ends_at, state, hold_expires_at)
    values (
      new.id, new.court_id, new.starts_at, new.ends_at,
      case when new.status = 'confirmed' then 'booked' else 'held' end,
      case when new.status = 'pending_payment' then new.hold_expires_at end
    )
    on conflict (booking_id) do update
      set court_id = excluded.court_id, starts_at = excluded.starts_at, ends_at = excluded.ends_at,
          state = excluded.state, hold_expires_at = excluded.hold_expires_at;
  else
    delete from court_occupancy where booking_id = new.id;
  end if;
  return new;
end $$;

drop trigger if exists bookings_sync_occupancy on public.bookings;
create trigger bookings_sync_occupancy
  after insert or update of status, hold_expires_at, court_id, starts_at, ends_at on public.bookings
  for each row execute function public.sync_occupancy();

-- ---------------------------------------------------------------------------
-- Storage: customers' receive QR codes and the shop's refund slips
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('refunds', 'refunds', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Customer: <uid>/<booking>-qr-<n>.<ext>, only for their own confirmed booking.
create policy "upload own refund qr" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'refunds'
    and exists (
      select 1 from public.bookings b
      where b.user_id = auth.uid()
        and b.status = 'confirmed'
        and name ~ ('^' || auth.uid()::text || '/' || b.id::text || '-qr-[0-9]+\.(jpg|jpeg|png|webp)$')
    )
  );

-- Admin: <customer uid>/<booking>-refund-<n>.<ext>
create policy "admins upload refund slips" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'refunds'
    and public.is_admin()
    and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}-refund-[0-9]+\.(jpg|jpeg|png|webp)$'
  );

create policy "read own refund files or admin" on storage.objects
  for select to authenticated
  using (bucket_id = 'refunds' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- ---------------------------------------------------------------------------
-- Customer RPCs
-- ---------------------------------------------------------------------------

-- The booking a customer may change: their own, paid, online, not started yet.
create function public.lock_changeable_booking(p_booking_id uuid) returns public.bookings
language plpgsql security definer set search_path = public as $$
declare
  v_row bookings;
begin
  select * into v_row from bookings where id = p_booking_id and user_id = auth.uid() for update;
  if not found then
    raise exception 'BOOKING_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_row.status <> 'confirmed' or v_row.channel <> 'online' or v_row.starts_at <= now() then
    raise exception 'INVALID_STATUS' using errcode = '22023';
  end if;
  if exists (select 1 from booking_requests where booking_id = p_booking_id and status = 'pending') then
    raise exception 'REQUEST_PENDING' using errcode = '22023';
  end if;
  return v_row;
end $$;

create function public.request_reschedule(p_booking_id uuid, p_court_id smallint, p_starts_at timestamptz)
returns public.booking_requests
language plpgsql security definer set search_path = public as $$
declare
  c_max_days constant int := 14;
  v_row     bookings := lock_changeable_booking(p_booking_id);
  v_length  interval := v_row.ends_at - v_row.starts_at;
  v_hours   numeric := extract(epoch from v_length) / 3600;
  v_local   timestamp := p_starts_at at time zone 'Asia/Bangkok';
  v_req     booking_requests;
begin
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
  if not opening_hours_ok(p_starts_at, v_hours) then
    raise exception 'OUTSIDE_OPENING_HOURS' using errcode = '22023';
  end if;
  if not exists (select 1 from courts where id = p_court_id and is_active) then
    raise exception 'COURT_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_court_id = v_row.court_id and p_starts_at = v_row.starts_at then
    raise exception 'SAME_SLOT' using errcode = '22023';
  end if;

  perform expire_holds();
  if exists (
    select 1 from bookings
    where court_id = p_court_id and id <> v_row.id
      and status in ('pending_payment', 'awaiting_review', 'confirmed')
      and tstzrange(starts_at, ends_at, '[)') && tstzrange(p_starts_at, p_starts_at + v_length, '[)')
  ) then
    raise exception 'SLOT_TAKEN' using errcode = '23P01';
  end if;

  insert into booking_requests (booking_id, user_id, kind, new_court_id, new_starts_at, new_ends_at)
  values (v_row.id, v_row.user_id, 'reschedule', p_court_id, p_starts_at, p_starts_at + v_length)
  returning * into v_req;
  return v_req;
end $$;

create function public.request_cancel(p_booking_id uuid, p_qr_path text, p_reason text default null)
returns public.booking_requests
language plpgsql security definer set search_path = public as $$
declare
  v_row bookings := lock_changeable_booking(p_booking_id);
  v_req booking_requests;
begin
  if p_qr_path is null
     or p_qr_path !~ ('^' || v_row.user_id::text || '/' || v_row.id::text || '-qr-[0-9]+\.(jpg|jpeg|png|webp)$')
     or not exists (select 1 from storage.objects where bucket_id = 'refunds' and name = p_qr_path) then
    raise exception 'INVALID_QR' using errcode = '22023';
  end if;

  insert into booking_requests (booking_id, user_id, kind, reason, refund_qr_path)
  values (v_row.id, v_row.user_id, 'cancel', nullif(left(trim(coalesce(p_reason, '')), 300), ''), p_qr_path)
  returning * into v_req;
  return v_req;
end $$;

create function public.withdraw_request(p_request_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update booking_requests set status = 'withdrawn', resolved_at = now()
  where id = p_request_id and user_id = auth.uid() and status = 'pending';
  if not found then
    raise exception 'REQUEST_NOT_FOUND' using errcode = 'P0002';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Admin RPC
-- ---------------------------------------------------------------------------

-- Approve or reject. Approving a cancel needs the refund slip already uploaded.
create function public.resolve_request(
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
  if v_req.status <> 'pending' then
    raise exception 'REQUEST_NOT_FOUND' using errcode = 'P0002';
  end if;

  if p_approve then
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
      if p_refund_slip_path is null
         or p_refund_slip_path !~ ('^' || v_booking.user_id::text || '/' || v_booking.id::text || '-refund-[0-9]+\.(jpg|jpeg|png|webp)$')
         or not exists (select 1 from storage.objects where bucket_id = 'refunds' and name = p_refund_slip_path) then
        raise exception 'REFUND_SLIP_REQUIRED' using errcode = '22023';
      end if;
      update bookings set status = 'cancelled' where id = v_booking.id;
    end if;
  end if;

  update booking_requests
  set status = case when p_approve then 'approved' else 'rejected' end,
      admin_note = nullif(left(trim(coalesce(p_note, '')), 300), ''),
      refund_slip_path = case when p_approve and kind = 'cancel' then p_refund_slip_path end,
      resolved_at = now(),
      resolved_by = auth.uid()
  where id = p_request_id
  returning * into v_req;
  return v_req;
end $$;

revoke execute on function public.lock_changeable_booking(uuid) from public, anon, authenticated;
revoke execute on function public.request_reschedule(uuid, smallint, timestamptz) from public, anon;
revoke execute on function public.request_cancel(uuid, text, text) from public, anon;
revoke execute on function public.withdraw_request(uuid) from public, anon;
revoke execute on function public.resolve_request(uuid, boolean, text, text) from public, anon;
grant execute on function public.request_reschedule(uuid, smallint, timestamptz) to authenticated;
grant execute on function public.request_cancel(uuid, text, text) to authenticated;
grant execute on function public.withdraw_request(uuid) to authenticated;
grant execute on function public.resolve_request(uuid, boolean, text, text) to authenticated;
