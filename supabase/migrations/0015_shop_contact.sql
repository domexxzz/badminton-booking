-- Who customers contact with questions. Shown on the customer pages and
-- edited by admins in the back office (Settings). Readable by everyone through
-- the existing "venue_settings are public" policy.

alter table public.venue_settings
  add column if not exists contact_name  text check (char_length(contact_name) <= 60),
  add column if not exists contact_phone text check (contact_phone ~ '^[0-9]{9,10}$'),
  add column if not exists contact_line  text check (char_length(contact_line) <= 200);

update public.venue_settings set contact_name = coalesce(contact_name, 'Akkanay') where id = 1;

create or replace function public.update_shop_contact(p_name text, p_phone text, p_line text) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), '');
  v_line  text := nullif(trim(coalesce(p_line, '')), '');
begin
  if not is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if v_phone is not null and v_phone !~ '^0[0-9]{8,9}$' then
    raise exception 'INVALID_PHONE' using errcode = '22023';
  end if;
  -- A LINE ID (letters, digits, . _ -, optional @ for an official account) or a line.me link.
  if v_line is not null
     and v_line !~ '^@?[A-Za-z0-9._-]{1,60}$'
     and v_line !~ '^https://(line\.me|lin\.ee)/[A-Za-z0-9/@._~%?=&-]{1,180}$' then
    raise exception 'INVALID_LINE' using errcode = '22023';
  end if;

  update venue_settings
  set contact_name  = nullif(left(trim(coalesce(p_name, '')), 60), ''),
      contact_phone = v_phone,
      contact_line  = v_line,
      updated_at    = now(),
      updated_by    = auth.uid()
  where id = 1;
end $$;

revoke execute on function public.update_shop_contact(text, text, text) from public, anon;
grant execute on function public.update_shop_contact(text, text, text) to authenticated;
