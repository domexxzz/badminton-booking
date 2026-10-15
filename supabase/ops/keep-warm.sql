-- Keep the production Vercel function warm so the first visitor after a quiet
-- spell doesn't pay for a cold start. Pings the home page every 5 minutes
-- (~8,600 requests/month, well inside the Vercel free quota).
--
-- Production only: run once in the Supabase SQL Editor. It is deliberately not
-- a migration, so a local `supabase db reset` never pings the live site.
-- Re-running is safe: cron.schedule() updates a job with the same name.

create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'keep-site-warm',
  '*/5 * * * *',
  $$select net.http_get(
      url := 'https://badminton-booking-steel.vercel.app/',
      timeout_milliseconds := 10000
    )$$
);

-- Check it is working (after 5-10 minutes), status_code should be 200:
--   select created, status_code, error_msg from net._http_response order by created desc limit 5;
-- Turn it off:
--   select cron.unschedule('keep-site-warm');
