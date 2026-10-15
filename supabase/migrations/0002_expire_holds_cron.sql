-- Expire unpaid holds every minute so abandoned slots free up on the board.
-- Requires the pg_cron extension (Supabase: Database -> Extensions -> pg_cron).
-- create_booking() also expires holds on demand, so the app still works without it;
-- the board just shows stale holds as free once their hold_expires_at has passed.

create extension if not exists pg_cron;

select cron.schedule(
  'expire-booking-holds',
  '* * * * *',
  $$select public.expire_holds()$$
);
