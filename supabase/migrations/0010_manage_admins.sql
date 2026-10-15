-- Admins grant or remove admin rights from the back office.
-- Guard rails: nobody removes their own rights (no accidental lock-out) and
-- the shop always keeps at least one admin.

create function public.set_admin(p_user_id uuid, p_is_admin boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() and not p_is_admin then
    raise exception 'CANNOT_REMOVE_SELF' using errcode = '22023';
  end if;

  -- Serialize changes so two admins can't remove each other at the same time.
  perform pg_advisory_xact_lock(7342);
  update profiles set is_admin = p_is_admin where id = p_user_id;
  if not found then
    raise exception 'USER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if not exists (select 1 from profiles where is_admin) then
    raise exception 'LAST_ADMIN' using errcode = '22023';
  end if;
end $$;

revoke execute on function public.set_admin(uuid, boolean) from public, anon;
grant execute on function public.set_admin(uuid, boolean) to authenticated;
