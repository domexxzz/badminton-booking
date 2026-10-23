-- 0027_party_host_role.sql
-- Allow admins to grant/revoke the party host role (is_party_host) to users
-- so the shop can enable party room creation when customers call or subscribe.

alter table public.profiles
  add column if not exists is_party_host boolean not null default false;

-- Backfill existing hosts so their permissions are preserved
update public.profiles
set is_party_host = true
where id in (select host_user_id from public.party_rooms);

-- Check if user can host parties (admin or designated party host)
create or replace function public.can_host_party(p_user_id uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
begin
  if p_user_id is null then return false; end if;
  return exists (
    select 1 from public.profiles
    where id = p_user_id and (is_admin = true or is_party_host = true)
  );
end $$;

-- Admin function to set party host role
create or replace function public.set_party_host(p_user_id uuid, p_is_party_host boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  update public.profiles set is_party_host = p_is_party_host where id = p_user_id;
  if not found then
    raise exception 'USER_NOT_FOUND' using errcode = 'P0002';
  end if;
end $$;

revoke execute on function public.set_party_host(uuid, boolean) from public, anon;
grant execute on function public.set_party_host(uuid, boolean) to authenticated;

notify pgrst, 'reload schema';
