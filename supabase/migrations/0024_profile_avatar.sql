-- 0024_profile_avatar.sql
-- Save and sync customer avatar (e.g. from LINE Login profile).

alter table public.profiles
  add column if not exists avatar_url text;

grant update (display_name, phone, avatar_url) on public.profiles to authenticated;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'line_picture')
  );
  return new;
end $$;

notify pgrst, 'reload schema';
