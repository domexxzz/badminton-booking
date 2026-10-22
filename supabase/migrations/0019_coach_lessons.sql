-- 0019_coach_lessons.sql
-- Lessons with a coach, paid through the site.
--
-- A lesson is an ordinary booking with a coach attached: the court is held and paid
-- exactly like any other booking (slip, review, cancel, refund all unchanged), and
-- the bill is court price + lesson fee. The shop pays the lesson fee on to the coach
-- later and records that with coach_paid_at.
--
-- Coaches (profiles.is_coach, 0014) write their own profile and weekly hours; a
-- customer can book a coach only inside those hours and never twice at once.

create table if not exists public.coach_profiles (
  user_id               uuid primary key references auth.users on delete cascade,
  display_name          text    not null check (char_length(display_name) between 1 and 60),
  bio                   text    check (char_length(bio) <= 500),
  lesson_price_per_hour integer not null check (lesson_price_per_hour between 0 and 5000), -- THB
  is_listed             boolean not null default false,
  updated_at            timestamptz not null default now()
);

-- Weekly hours, Bangkok time. weekday follows extract(dow): 0 = Sunday.
create table if not exists public.coach_availability (
  id           uuid primary key default gen_random_uuid(),
  coach_id     uuid     not null references public.coach_profiles on delete cascade,
  weekday      smallint not null check (weekday between 0 and 6),
  start_minute smallint not null check (start_minute between 0 and 1410 and start_minute % 30 = 0),
  end_minute   smallint not null check (end_minute between 30 and 1440 and end_minute % 30 = 0),
  check (end_minute > start_minute)
);

create index if not exists coach_availability_coach_idx on public.coach_availability (coach_id, weekday);

alter table public.bookings
  add column if not exists coach_id      uuid references public.coach_profiles (user_id),
  add column if not exists lesson_fee    numeric(10, 2) check (lesson_fee >= 0), -- part of amount
  add column if not exists coach_paid_at timestamptz; -- the shop paid the lesson fee on to the coach

-- The real guarantee that a coach is never booked twice, including concurrent requests.
alter table public.bookings add constraint no_double_coach exclude using gist (
  coach_id with =,
  tstzrange(starts_at, ends_at, '[)') with &&
) where (coach_id is not null and status in ('pending_payment', 'awaiting_review', 'confirmed'));

create index if not exists bookings_coach_idx on public.bookings (coach_id, starts_at) where coach_id is not null;

-- A lesson was agreed for a time inside the coach's hours; a customer moving it
-- (reschedule requests, 0009) would skip that check, so for them the time is fixed:
-- cancel and book again. The shop may still move one by hand (rain, coach sick) —
-- the no_double_coach constraint keeps that from double-booking the coach.
create or replace function public.lock_lesson_time() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.coach_id is not null
     and (new.starts_at <> old.starts_at or new.ends_at <> old.ends_at)
     and not is_admin() then
    raise exception 'LESSON_FIXED_TIME' using errcode = '22023';
  end if;
  return new;
end $$;

drop trigger if exists bookings_lock_lesson_time on public.bookings;
create trigger bookings_lock_lesson_time before update of starts_at, ends_at on public.bookings
  for each row execute function public.lock_lesson_time();

-- Asking to move a lesson (0009) would be refused when the admin approved it, so it
-- is refused right away, while the customer is still on the page.
create or replace function public.reject_lesson_reschedule() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'reschedule'
     and exists (select 1 from bookings b where b.id = new.booking_id and b.coach_id is not null) then
    raise exception 'LESSON_FIXED_TIME' using errcode = '22023';
  end if;
  return new;
end $$;

drop trigger if exists booking_requests_reject_lesson on public.booking_requests;
create trigger booking_requests_reject_lesson before insert on public.booking_requests
  for each row execute function public.reject_lesson_reschedule();

revoke execute on function public.reject_lesson_reschedule() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Busy = a lesson with this coach, or a court the coach booked for themself.
create or replace function public.coach_busy(p_coach_id uuid, p_starts_at timestamptz, p_ends_at timestamptz)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from bookings b
    where (b.coach_id = p_coach_id or b.user_id = p_coach_id)
      and b.status in ('pending_payment', 'awaiting_review', 'confirmed')
      and tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(p_starts_at, p_ends_at, '[)')
  )
$$;

create or replace function public.coach_hours_ok(p_coach_id uuid, p_starts_at timestamptz, p_hours numeric)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from coach_availability a
    where a.coach_id = p_coach_id
      and a.weekday = extract(dow from p_starts_at at time zone 'Asia/Bangkok')
      and a.start_minute <= extract(hour from p_starts_at at time zone 'Asia/Bangkok') * 60
                            + extract(minute from p_starts_at at time zone 'Asia/Bangkok')
      and a.end_minute >= extract(hour from p_starts_at at time zone 'Asia/Bangkok') * 60
                          + extract(minute from p_starts_at at time zone 'Asia/Bangkok') + p_hours * 60
  )
$$;

-- Admin, or the person acting on their own profile. Whether they are a coach at all
-- is checked separately, so a customer gets "you are not a coach yet" instead of a
-- bare "not allowed".
create or replace function public.can_edit_coach(p_user_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_admin() or p_user_id = auth.uid()
$$;

-- Revoking coach rights also takes the coach off the public list (0014 + unlist).
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
  if not p_is_coach then
    update coach_profiles set is_listed = false, updated_at = now() where user_id = p_user_id;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Coach profile and hours
-- ---------------------------------------------------------------------------

create or replace function public.save_coach_profile(
  p_user_id      uuid,
  p_display_name text,
  p_bio          text,
  p_price        integer,
  p_is_listed    boolean
) returns public.coach_profiles
language plpgsql security definer set search_path = public as $$
declare
  v_name text := left(regexp_replace(trim(coalesce(p_display_name, '')), '\s+', ' ', 'g'), 60);
  v_bio  text := nullif(trim(coalesce(p_bio, '')), '');
  v_row  coach_profiles;
begin
  if p_user_id is null or not can_edit_coach(p_user_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if not coalesce((select is_coach from profiles where id = p_user_id), false) then
    raise exception 'NOT_COACH' using errcode = '42501';
  end if;
  if v_name = '' then
    raise exception 'INVALID_NAME' using errcode = '22023';
  end if;
  if char_length(v_bio) > 500 then
    raise exception 'INVALID_BIO' using errcode = '22023';
  end if;
  if p_price is null or p_price < 0 or p_price > 5000 then
    raise exception 'INVALID_LESSON_PRICE' using errcode = '22023';
  end if;

  insert into coach_profiles (user_id, display_name, bio, lesson_price_per_hour, is_listed, updated_at)
  values (p_user_id, v_name, v_bio, p_price, coalesce(p_is_listed, false), now())
  on conflict (user_id) do update
    set display_name = excluded.display_name, bio = excluded.bio,
        lesson_price_per_hour = excluded.lesson_price_per_hour,
        is_listed = excluded.is_listed, updated_at = now()
  returning * into v_row;
  return v_row;
end $$;

-- Replaces the coach's weekly hours with p_slots: [{weekday, start_minute, end_minute}, ...].
-- Lessons already booked are kept even if they now fall outside the new hours.
create or replace function public.set_coach_availability(p_user_id uuid, p_slots jsonb)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  c_max_slots constant int := 28;
  v_slot jsonb;
  v_n    int := 0;
begin
  if p_user_id is null or not can_edit_coach(p_user_id) then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if not exists (select 1 from coach_profiles where user_id = p_user_id) then
    raise exception 'COACH_PROFILE_REQUIRED' using errcode = '22023';
  end if;
  if p_slots is null or jsonb_typeof(p_slots) <> 'array' or jsonb_array_length(p_slots) > c_max_slots then
    raise exception 'INVALID_AVAILABILITY' using errcode = '22023';
  end if;

  delete from coach_availability where coach_id = p_user_id;
  for v_slot in select * from jsonb_array_elements(p_slots) loop
    begin
      insert into coach_availability (coach_id, weekday, start_minute, end_minute)
      values (
        p_user_id,
        (v_slot->>'weekday')::smallint,
        (v_slot->>'start_minute')::smallint,
        (v_slot->>'end_minute')::smallint
      );
    exception when check_violation or not_null_violation or invalid_text_representation or numeric_value_out_of_range then
      raise exception 'INVALID_AVAILABILITY' using errcode = '22023';
    end;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- ---------------------------------------------------------------------------
-- Booking a lesson
-- ---------------------------------------------------------------------------

-- Start times a customer can book, for one Bangkok day. Shows only free times,
-- never who booked what, so anyone may call it.
create or replace function public.coach_open_starts(p_coach_id uuid, p_day date, p_hours numeric)
returns setof timestamptz
language sql stable security definer set search_path = public as $$
  select distinct s
  from coach_profiles cp
  join profiles p on p.id = cp.user_id and p.is_coach
  join coach_availability a on a.coach_id = cp.user_id and a.weekday = extract(dow from p_day)
  cross join lateral generate_series(
    (p_day + make_interval(mins => a.start_minute)) at time zone 'Asia/Bangkok',
    (p_day + make_interval(mins => a.end_minute - round(p_hours * 60)::int)) at time zone 'Asia/Bangkok',
    interval '30 minutes'
  ) s
  where cp.user_id = p_coach_id
    and cp.is_listed
    and p_hours between 1 and 3 and p_hours * 2 = round(p_hours * 2)
    and s > now()
    and s <= now() + interval '14 days'
    and opening_hours_ok(s, p_hours)
    and not coach_busy(p_coach_id, s, s + make_interval(mins => round(p_hours * 60)::int))
    and exists (
      select 1 from courts c
      where c.is_active and not exists (
        select 1 from bookings b
        where b.court_id = c.id
          and b.status in ('pending_payment', 'awaiting_review', 'confirmed')
          and tstzrange(b.starts_at, b.ends_at, '[)')
              && tstzrange(s, s + make_interval(mins => round(p_hours * 60)::int), '[)')
      )
    )
  order by s
$$;

-- Holds the first free court through create_cart_booking() (same limits and 5-minute
-- hold as any booking), then adds the coach and the lesson fee to the bill.
create or replace function public.create_lesson_booking(p_coach_id uuid, p_starts_at timestamptz, p_hours numeric)
returns public.bookings
language plpgsql security definer set search_path = public as $$
declare
  c_min_hours constant numeric := 1.0;
  c_max_hours constant numeric := 3.0;
  v_uid      uuid := auth.uid();
  v_price    integer;
  v_fee      numeric(10, 2);
  v_court_id smallint;
  v_row      bookings;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;
  if p_coach_id = v_uid then
    raise exception 'CANNOT_BOOK_SELF' using errcode = '22023';
  end if;

  select cp.lesson_price_per_hour into v_price
  from coach_profiles cp join profiles p on p.id = cp.user_id
  where cp.user_id = p_coach_id and cp.is_listed and p.is_coach;
  if not found then
    raise exception 'COACH_NOT_FOUND' using errcode = 'P0002';
  end if;

  if p_hours is null or p_hours < c_min_hours or p_hours > c_max_hours or (p_hours * 2) <> round(p_hours * 2) then
    raise exception 'INVALID_DURATION' using errcode = '22023';
  end if;
  if p_starts_at is null then
    raise exception 'INVALID_START' using errcode = '22023';
  end if;

  -- One lesson booking at a time per coach, so the checks below cannot race.
  perform pg_advisory_xact_lock(hashtextextended('coach:' || p_coach_id::text, 0));
  if not coach_hours_ok(p_coach_id, p_starts_at, p_hours) then
    raise exception 'COACH_UNAVAILABLE' using errcode = '22023';
  end if;
  perform expire_holds();
  -- The no_double_coach constraint only sees lessons. A coach who booked a court to
  -- play on themselves is busy too, and only this check knows that.
  if coach_busy(p_coach_id, p_starts_at, p_starts_at + make_interval(mins => round(p_hours * 60)::int)) then
    raise exception 'COACH_BUSY' using errcode = '23P01';
  end if;

  for v_court_id in select id from courts where is_active order by id loop
    begin
      v_row := create_cart_booking(jsonb_build_array(jsonb_build_object(
        'court_id', v_court_id, 'starts_at', p_starts_at, 'hours', p_hours)));
      exit;
    exception when exclusion_violation then
      v_row := null; -- this court is taken: try the next one
    end;
  end loop;
  if v_row.id is null then
    raise exception 'SLOT_TAKEN' using errcode = '23P01';
  end if;

  v_fee := round(v_price * p_hours);
  begin
    update bookings
    set coach_id = p_coach_id, lesson_fee = v_fee, amount = amount + v_fee
    where id = v_row.id
    returning * into v_row;
  exception when exclusion_violation then
    raise exception 'COACH_BUSY' using errcode = '23P01';
  end;
  return v_row;
end $$;

-- ---------------------------------------------------------------------------
-- Coach and shop views
-- ---------------------------------------------------------------------------

-- The calling coach's lessons with the student's name and phone (profiles are private).
create or replace function public.coach_lessons()
returns table (
  booking_id    uuid,
  starts_at     timestamptz,
  ends_at       timestamptz,
  court_name    text,
  status        public.booking_status,
  lesson_fee    numeric,
  coach_paid_at timestamptz,
  student_name  text,
  student_phone text
)
language sql stable security definer set search_path = public as $$
  select b.id, b.starts_at, b.ends_at, c.name, b.status, b.lesson_fee, b.coach_paid_at,
         p.display_name, p.phone
  from bookings b
  join courts c on c.id = b.court_id
  left join profiles p on p.id = b.user_id
  where b.coach_id = auth.uid()
    and b.status in ('pending_payment', 'awaiting_review', 'confirmed')
    and b.ends_at > now() - interval '30 days'
  order by b.starts_at
  limit 200
$$;

-- Admin: the shop paid the coach for every finished, confirmed lesson not paid yet.
create or replace function public.mark_coach_paid(p_coach_id uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_n int;
begin
  if not is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  update bookings set coach_paid_at = now()
  where coach_id = p_coach_id and status = 'confirmed' and coach_paid_at is null and ends_at <= now();
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ---------------------------------------------------------------------------
-- Privileges & RLS
-- ---------------------------------------------------------------------------

revoke execute on function public.lock_lesson_time() from public, anon, authenticated;
revoke execute on function public.coach_busy(uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke execute on function public.coach_hours_ok(uuid, timestamptz, numeric) from public, anon, authenticated;
revoke execute on function public.can_edit_coach(uuid) from public, anon, authenticated;
revoke execute on function public.save_coach_profile(uuid, text, text, integer, boolean) from public, anon;
revoke execute on function public.set_coach_availability(uuid, jsonb) from public, anon;
revoke execute on function public.create_lesson_booking(uuid, timestamptz, numeric) from public, anon;
revoke execute on function public.coach_lessons() from public, anon;
revoke execute on function public.mark_coach_paid(uuid) from public, anon;
revoke execute on function public.coach_open_starts(uuid, date, numeric) from public;
grant execute on function public.save_coach_profile(uuid, text, text, integer, boolean) to authenticated;
grant execute on function public.set_coach_availability(uuid, jsonb) to authenticated;
grant execute on function public.create_lesson_booking(uuid, timestamptz, numeric) to authenticated;
grant execute on function public.coach_lessons() to authenticated;
grant execute on function public.mark_coach_paid(uuid) to authenticated;
grant execute on function public.coach_open_starts(uuid, date, numeric) to anon, authenticated;

alter table public.coach_profiles     enable row level security;
alter table public.coach_availability enable row level security;

-- Listed coaches are public; a customer also keeps seeing a coach they booked.
drop policy if exists "listed coaches are public" on public.coach_profiles;
create policy "listed coaches are public" on public.coach_profiles
  for select to anon, authenticated using (
    is_listed
    or user_id = auth.uid()
    or public.is_admin()
    or exists (select 1 from public.bookings b where b.coach_id = coach_profiles.user_id and b.user_id = auth.uid())
  );

drop policy if exists "hours of visible coaches are public" on public.coach_availability;
create policy "hours of visible coaches are public" on public.coach_availability
  for select to anon, authenticated using (
    exists (select 1 from public.coach_profiles cp where cp.user_id = coach_availability.coach_id)
  );
