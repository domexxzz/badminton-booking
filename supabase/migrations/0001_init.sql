-- Badminton court booking: 4 courts, realtime availability, PromptPay slip payments.
-- Every write goes through SECURITY DEFINER RPCs below; clients never insert/update
-- bookings directly, so price, hours and status transitions are enforced here.

create extension if not exists btree_gist;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.courts (
  id             smallint primary key,
  name           text     not null,
  price_per_hour integer  not null check (price_per_hour > 0), -- THB
  is_active      boolean  not null default true
);

insert into public.courts (id, name, price_per_hour) values
  (1, 'สนาม 1', 130),
  (2, 'สนาม 2', 130),
  (3, 'สนาม 3', 130),
  (4, 'สนาม 4', 130);

create table public.profiles (
  id           uuid primary key references auth.users on delete cascade,
  display_name text,
  phone        text,
  is_admin     boolean     not null default false,
  created_at   timestamptz not null default now()
);

create type public.booking_status as enum (
  'pending_payment',  -- slot held, waiting for transfer + slip
  'awaiting_review',  -- slip uploaded, admin must verify
  'confirmed',
  'cancelled',
  'expired'
);

create table public.bookings (
  id              uuid primary key default gen_random_uuid(),
  court_id        smallint    not null references public.courts,
  user_id         uuid        not null references auth.users on delete cascade,
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  amount          numeric(10, 2) not null check (amount > 0), -- THB, incl. a unique satang suffix
  status          public.booking_status not null default 'pending_payment',
  hold_expires_at timestamptz,
  review_note     text,
  -- Phone/LINE/walk-in bookings are entered by an admin (0005) for a named customer.
  channel         text not null default 'online' check (channel in ('online', 'phone', 'line', 'walk_in')),
  customer_name   text check (char_length(customer_name) <= 100),
  customer_phone  text check (char_length(customer_phone) <= 20),
  admin_note      text check (char_length(admin_note) <= 300),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (ends_at > starts_at),
  check (channel = 'online' or nullif(trim(customer_name), '') is not null),
  -- The real guarantee against double booking, including concurrent requests.
  constraint no_double_booking exclude using gist (
    court_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status in ('pending_payment', 'awaiting_review', 'confirmed'))
);

create index bookings_user_idx   on public.bookings (user_id, created_at desc);
-- No two open bookings share an exact amount, so a transfer maps to one booking.
create unique index bookings_open_amount_uniq on public.bookings (amount)
  where status in ('pending_payment', 'awaiting_review');
create index bookings_amount_idx on public.bookings (amount, updated_at);
create index bookings_status_idx on public.bookings (status);

create table public.payments (
  id          uuid primary key default gen_random_uuid(),
  booking_id  uuid        not null references public.bookings on delete cascade,
  user_id     uuid        not null references auth.users on delete cascade,
  amount      numeric(10, 2) not null,
  slip_path   text        not null,
  status      text        not null default 'submitted'
              check (status in ('submitted', 'approved', 'rejected')),
  reviewed_by uuid references auth.users,
  reviewed_at timestamptz,
  created_at  timestamptz not null default now()
);

create index payments_booking_idx on public.payments (booking_id, created_at desc);

-- Public, PII-free mirror of active bookings. Anyone (even logged out) can read
-- and subscribe to it, which is what drives the realtime court board.
create table public.court_occupancy (
  booking_id      uuid primary key references public.bookings on delete cascade,
  court_id        smallint    not null,
  starts_at       timestamptz not null,
  ends_at         timestamptz not null,
  state           text        not null check (state in ('held', 'booked')),
  hold_expires_at timestamptz
);

create index court_occupancy_time_idx on public.court_occupancy (starts_at);
alter table public.court_occupancy replica identity full; -- DELETE events carry the row

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

create function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger bookings_touch before update on public.bookings
  for each row execute function public.touch_updated_at();

create function public.sync_occupancy() returns trigger
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
      set state = excluded.state, hold_expires_at = excluded.hold_expires_at;
  else
    delete from court_occupancy where booking_id = new.id;
  end if;
  return new;
end $$;

create trigger bookings_sync_occupancy
  after insert or update of status, hold_expires_at on public.bookings
  for each row execute function public.sync_occupancy();

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)));
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from profiles where id = auth.uid()), false)
$$;

create function public.expire_holds() returns integer
language sql security definer set search_path = public as $$
  with expired as (
    update bookings set status = 'expired'
    where status = 'pending_payment' and hold_expires_at < now()
    returning 1
  )
  select count(*)::int from expired
$$;

-- Opening hours, defined once for every booking path.
-- Keep in sync with src/lib/config.ts (BOOKING_RULES.openHour / closeHour).
create function public.opening_hours_ok(p_starts_at timestamptz, p_hours int) returns boolean
language sql stable as $$
  select extract(hour from p_starts_at at time zone 'Asia/Bangkok') >= 9
     and extract(hour from p_starts_at at time zone 'Asia/Bangkok') + p_hours <= 23
$$;

-- Base price plus a satang suffix (e.g. 300.37) that no open booking uses and
-- that cooled down after its last use (6h after confirmation, 3h after expiry,
-- 30 min after a cancel), so a late transfer for a closed booking can never confirm
-- a stranger's new one. Caller must hold the amount advisory lock.
-- Returns null when all 99 suffixes are taken.
create function public.pick_booking_amount(p_base numeric) returns numeric
language sql volatile security definer set search_path = public as $$
  select (p_base + s / 100.0)::numeric(10, 2)
  from generate_series(1, 99) s
  where not exists (
    select 1 from bookings b
    where b.amount = p_base + s / 100.0
      and (
        b.status in ('pending_payment', 'awaiting_review')
        or (b.status = 'cancelled' and b.updated_at > now() - interval '30 minutes')
        or (b.status = 'expired' and b.updated_at > now() - interval '3 hours')
        or (b.status = 'confirmed' and b.updated_at > now() - interval '6 hours')
      )
  )
  order by random()
  limit 1
$$;

-- ---------------------------------------------------------------------------
-- RPCs (the only write path for clients)
-- Keep these limits in sync with src/lib/config.ts (BOOKING_RULES).
-- ---------------------------------------------------------------------------

create function public.create_booking(p_court_id smallint, p_starts_at timestamptz, p_hours int)
returns public.bookings
language plpgsql security definer set search_path = public as $$
declare
  c_max_hours     constant int := 4;
  c_max_days      constant int := 14;
  c_hold_minutes  constant int := 15;
  c_max_open      constant int := 3; -- unconfirmed bookings (unpaid or slip under review) per user
  c_max_per_hour  constant int := 6; -- bookings created per user per hour, any outcome
  c_amount_lock   constant bigint := 7341; -- advisory lock key for picking amounts
  v_uid    uuid := auth.uid();
  v_local  timestamp := p_starts_at at time zone 'Asia/Bangkok';
  v_court  courts;
  v_amount numeric(10, 2);
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

  -- Create/cancel churn would burn through satang amounts for everyone.
  if (select count(*) from bookings
      where user_id = v_uid and created_at > now() - interval '1 hour') >= c_max_per_hour then
    raise exception 'TOO_MANY_RECENT_BOOKINGS' using errcode = '22023';
  end if;

  -- Slips under review count too, or junk uploads could squat courts until an admin acts.
  if (select count(*) from bookings
      where user_id = v_uid and status in ('pending_payment', 'awaiting_review')) >= c_max_open then
    raise exception 'TOO_MANY_HOLDS' using errcode = '22023';
  end if;

  -- The exact amount (with its unique satang) is what ties a transfer to this
  -- booking, both for slips and for incoming-transfer notifications.
  perform pg_advisory_xact_lock(c_amount_lock);
  v_amount := pick_booking_amount(v_court.price_per_hour * p_hours);
  if v_amount is null then
    raise exception 'BUSY_TRY_AGAIN' using errcode = '55P03';
  end if;

  begin
    insert into bookings (court_id, user_id, starts_at, ends_at, amount, status, hold_expires_at)
    values (
      p_court_id, v_uid, p_starts_at, p_starts_at + make_interval(hours => p_hours),
      v_amount, 'pending_payment',
      now() + make_interval(mins => c_hold_minutes)
    )
    returning * into v_row;
  exception when exclusion_violation then
    raise exception 'SLOT_TAKEN' using errcode = '23P01';
  end;

  return v_row;
end $$;

create function public.submit_slip(p_booking_id uuid, p_slip_path text)
returns public.bookings
language plpgsql security definer set search_path = public as $$
declare
  c_max_attempts constant int := 3; -- rejected slips per booking before an admin must step in
  v_uid uuid := auth.uid();
  v_row bookings;
begin
  select * into v_row from bookings
  where id = p_booking_id and user_id = v_uid
  for update;
  if not found then
    raise exception 'BOOKING_NOT_FOUND' using errcode = 'P0002';
  end if;
  -- A lapsed hold that has not been expired yet still owns its slot (the
  -- exclusion constraint guarantees nobody else took it), so accept a late slip
  -- rather than leave a customer who already paid without a booking.
  if v_row.status <> 'pending_payment' then
    raise exception '%', case when v_row.status = 'expired' then 'HOLD_EXPIRED' else 'INVALID_STATUS' end
      using errcode = '22023';
  end if;
  -- Path must be <uid>/<booking>-<timestamp>.<ext> and the file must exist.
  if p_slip_path !~ ('^' || v_uid::text || '/' || p_booking_id::text || '-[0-9]+\.(jpg|jpeg|png|webp)$')
     or not exists (select 1 from storage.objects where bucket_id = 'slips' and name = p_slip_path) then
    raise exception 'INVALID_SLIP' using errcode = '22023';
  end if;
  if (select count(*) from payments where booking_id = v_row.id and status = 'rejected') >= c_max_attempts then
    raise exception 'TOO_MANY_SLIP_ATTEMPTS' using errcode = '22023';
  end if;

  insert into payments (booking_id, user_id, amount, slip_path)
  values (v_row.id, v_uid, v_row.amount, p_slip_path);

  update bookings
  set status = 'awaiting_review', hold_expires_at = null, review_note = null
  where id = v_row.id
  returning * into v_row;

  return v_row;
end $$;

create function public.review_payment(p_booking_id uuid, p_approve boolean, p_note text default null)
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
    where id = p_booking_id returning * into v_row;
  else
    -- Give the customer a fresh window to re-upload a correct slip.
    update bookings
    set status = 'pending_payment',
        hold_expires_at = now() + make_interval(mins => c_hold_minutes),
        review_note = coalesce(nullif(trim(p_note), ''), 'สลิปไม่ถูกต้อง กรุณาอัปโหลดใหม่')
    where id = p_booking_id returning * into v_row;
  end if;

  return v_row;
end $$;

create function public.cancel_booking(p_booking_id uuid)
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

  update bookings set status = 'cancelled' where id = p_booking_id returning * into v_row;
  return v_row;
end $$;

-- ---------------------------------------------------------------------------
-- Privileges & RLS
-- ---------------------------------------------------------------------------

revoke execute on function public.expire_holds() from public, anon, authenticated;
revoke execute on function public.pick_booking_amount(numeric) from public, anon, authenticated;
revoke execute on function public.create_booking(smallint, timestamptz, int) from public, anon;
revoke execute on function public.submit_slip(uuid, text) from public, anon;
revoke execute on function public.review_payment(uuid, boolean, text) from public, anon;
revoke execute on function public.cancel_booking(uuid) from public, anon;
grant execute on function public.create_booking(smallint, timestamptz, int) to authenticated;
grant execute on function public.submit_slip(uuid, text) to authenticated;
grant execute on function public.review_payment(uuid, boolean, text) to authenticated;
grant execute on function public.cancel_booking(uuid) to authenticated;

alter table public.courts          enable row level security;
alter table public.profiles        enable row level security;
alter table public.bookings        enable row level security;
alter table public.payments        enable row level security;
alter table public.court_occupancy enable row level security;

create policy "courts are public" on public.courts
  for select to anon, authenticated using (true);

create policy "occupancy is public" on public.court_occupancy
  for select to anon, authenticated using (true);

create policy "read own profile or admin" on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_admin());
create policy "update own profile" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
-- Users may edit their name/phone but never promote themselves to admin.
revoke update on public.profiles from authenticated;
grant update (display_name, phone) on public.profiles to authenticated;

create policy "read own bookings or admin" on public.bookings
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

create policy "read own payments or admin" on public.payments
  for select to authenticated using (user_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------------
-- Storage: private bucket for transfer slips
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('slips', 'slips', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Only for one of your own unpaid bookings, and only with the expected filename.
create policy "upload own slips" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'slips'
    and exists (
      select 1 from public.bookings b
      where b.user_id = auth.uid()
        and b.status = 'pending_payment'
        and name ~ ('^' || auth.uid()::text || '/' || b.id::text || '-[0-9]+\.(jpg|jpeg|png|webp)$')
    )
  );

create policy "read own slips or admin" on storage.objects
  for select to authenticated
  using (bucket_id = 'slips' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table public.court_occupancy, public.bookings;
