-- LINE Login. The server sets a profile's LINE user id only after LINE has
-- verified the login; users cannot change it (profiles column grants, 0001).
-- Admins who log in with LINE and add the shop's LINE OA as a friend receive
-- shop notifications (bookings confirmed, slips to review, unmatched money).

alter table public.profiles
  add column line_user_id text unique check (line_user_id ~ '^U[0-9a-f]{32}$');

create index profiles_admin_line_idx on public.profiles (is_admin) where line_user_id is not null;

-- LINE users get a random placeholder email on this domain (src/lib/line/identity.ts).
-- Nobody else may register on it: only accounts the server created, which carry
-- the LINE id in app_metadata (writable by the service role only).
-- Deferred to commit time and re-reading the row, because Supabase Auth may
-- write app_metadata in a later statement of the same transaction.
create function public.guard_line_placeholder_emails() returns trigger
language plpgsql security definer set search_path = auth, public as $$
declare
  v_email text;
  v_meta  jsonb;
begin
  select email, raw_app_meta_data into v_email, v_meta from auth.users where id = new.id;
  if found
     and lower(v_email) like '%@line-login.invalid'
     and coalesce(v_meta ->> 'line_user_id', '') !~ '^U[0-9a-f]{32}$' then
    raise exception 'LINE_EMAIL_RESERVED' using errcode = '42501';
  end if;
  return null;
end $$;

create constraint trigger guard_line_placeholder_emails
  after insert or update on auth.users
  deferrable initially deferred
  for each row execute function public.guard_line_placeholder_emails();
