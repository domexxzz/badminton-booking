-- 0011_venue_settings.sql
-- Allow admins to configure venue opening and closing hours dynamically.
-- Updates opening_hours_ok to read from public.venue_settings instead of hardcoded numbers.

create table if not exists public.venue_settings (
  id           int         primary key check (id = 1),
  open_hour    numeric     not null default 9.0 check (open_hour >= 0 and open_hour < close_hour),
  close_hour   numeric     not null default 23.0 check (close_hour > open_hour and close_hour <= 24.0),
  updated_at   timestamptz not null default now(),
  updated_by   uuid        references auth.users(id)
);

-- Seed default settings (9:00 - 23:00)
insert into public.venue_settings (id, open_hour, close_hour)
values (1, 9.0, 23.0)
on conflict (id) do nothing;

alter table public.venue_settings enable row level security;

-- Anyone can read opening hours (customers and guests need to see slot buttons)
create policy "venue_settings are public" on public.venue_settings
  for select to anon, authenticated using (true);

-- Admin update function
create or replace function public.update_venue_hours(p_open_hour numeric, p_close_hour numeric) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  if p_open_hour is null or p_close_hour is null
     or p_open_hour < 0 or p_close_hour > 24
     or p_open_hour >= p_close_hour
     or (p_open_hour * 2) <> round(p_open_hour * 2)
     or (p_close_hour * 2) <> round(p_close_hour * 2) then
    raise exception 'INVALID_HOURS' using errcode = '22023';
  end if;

  update public.venue_settings
  set open_hour = p_open_hour,
      close_hour = p_close_hour,
      updated_at = now(),
      updated_by = auth.uid()
  where id = 1;
end $$;

revoke execute on function public.update_venue_hours(numeric, numeric) from public, anon;
grant execute on function public.update_venue_hours(numeric, numeric) to authenticated;

-- Update opening_hours_ok to use dynamic venue_settings (with fallback to 9.0 and 23.0)
create or replace function public.opening_hours_ok(p_starts_at timestamptz, p_hours numeric) returns boolean
language sql stable as $$
  select
    extract(hour from p_starts_at at time zone 'Asia/Bangkok') + (extract(minute from p_starts_at at time zone 'Asia/Bangkok') / 60.0) >= coalesce((select open_hour from public.venue_settings where id = 1), 9.0)
    and extract(hour from p_starts_at at time zone 'Asia/Bangkok') + (extract(minute from p_starts_at at time zone 'Asia/Bangkok') / 60.0) + p_hours <= coalesce((select close_hour from public.venue_settings where id = 1), 23.0)
$$;
