-- 0037_lock_mao_moi.sql
--
-- ก๊วนเม้ามอย plays every Monday, Wednesday and Friday, for good:
--   court 1      20:00-23:00
--   courts 2-4   19:00-23:00
--
-- This is for that one ก๊วน, not a general feature. The nights are entered as ordinary
-- admin bookings 14 days ahead, topped up every night. Customers can book only 7 days
-- ahead (0035), so nobody can reach a night before it is locked.
--
-- * Each night is one bill, owed (pay_later) until an admin presses "รับเงินแล้ว".
-- * A court somebody already has is left alone; it is locked later if it frees up.
-- * Cancelling a night from its booking page frees every court that night, and it stays
--   free: a cancelled night is never locked again.
--
-- To stop for good (nights already locked are cancelled from their booking pages):
--   select cron.unschedule('lock-mao-moi');

create or replace function public.lock_mao_moi_courts() returns integer
language plpgsql security definer set search_path = public as $$
declare
  c_days_ahead constant int := 14;
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_admin uuid;
  v_added integer;
begin
  -- bookings.user_id is required; like every admin booking it points at an admin.
  select id into v_admin from profiles where is_admin order by created_at, id limit 1;
  if v_admin is null then
    raise warning 'lock_mao_moi_courts: there is no admin, nothing was locked';
    return 0;
  end if;

  perform expire_holds();

  insert into bookings (
    court_id, user_id, starts_at, ends_at, amount, status,
    channel, customer_name, admin_note, group_id, pay_later
  )
  select
    c.id, v_admin, n.starts_at, n.starts_at + make_interval(hours => n.hours),
    round(c.price_per_hour * n.hours), 'confirmed',
    'line', 'ก๊วนเม้ามอย', '[จองประจำ] ล็อกอัตโนมัติ', n.group_id, true
  from (
    select
      r.court_id, r.hours,
      (d.day + make_interval(hours => r.start_hour)) at time zone 'Asia/Bangkok' as starts_at,
      -- One fixed id per night: the night's bill, and how a rerun recognises it.
      md5('lock-mao-moi:' || to_char(d.day, 'YYYY-MM-DD'))::uuid as group_id
    from (select v_today + i as day from generate_series(0, c_days_ahead) i) d
    cross join (values (1, 20, 3), (2, 19, 4), (3, 19, 4), (4, 19, 4)) r(court_id, start_hour, hours)
    where extract(isodow from d.day) in (1, 3, 5)
  ) n
  join courts c on c.id = n.court_id and c.is_active
  where n.starts_at > now()
    and opening_hours_ok(n.starts_at, n.hours)
    and not exists (
      select 1 from bookings b
      where b.group_id = n.group_id and (b.court_id = n.court_id or b.status = 'cancelled')
    )
  -- no_double_booking: whoever has the court keeps it.
  on conflict do nothing;

  get diagnostics v_added = row_count;
  return v_added;
end $$;

revoke execute on function public.lock_mao_moi_courts() from public, anon, authenticated;

-- The sandbox (PGlite) has no pg_cron. Without the nightly job the lock would quietly run
-- out after 14 days, so say so.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- 17:10 UTC is 00:10 in Bangkok.
    perform cron.schedule('lock-mao-moi', '10 17 * * *', 'select public.lock_mao_moi_courts()');
  else
    raise warning 'pg_cron is not installed: the ก๊วนเม้ามอย lock will not renew itself';
  end if;
end $$;

select public.lock_mao_moi_courts();
