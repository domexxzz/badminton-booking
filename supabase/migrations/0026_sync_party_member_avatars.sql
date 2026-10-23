-- 0026_sync_party_member_avatars.sql
-- Automatically propagate user profile avatar and display name changes to party_member_board
-- so everyone in the room sees up-to-date player photos and names in real-time.

create or replace function public.sync_profile_to_party_member_board() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.avatar_url is distinct from old.avatar_url or new.display_name is distinct from old.display_name then
    update public.party_member_board b
    set avatar_url = new.avatar_url,
        name = coalesce(new.display_name, b.name)
    from public.party_members m
    where m.id = b.entry_id and m.user_id = new.id and m.status = 'active';
  end if;
  return new;
end $$;

drop trigger if exists profiles_sync_party_member_board on public.profiles;
create trigger profiles_sync_party_member_board
  after update of avatar_url, display_name on public.profiles
  for each row execute function public.sync_profile_to_party_member_board();

-- Also ensure handle_new_user picks up Google 'picture' attribute
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture', new.raw_user_meta_data ->> 'line_picture')
  )
  on conflict (id) do update set
    avatar_url = coalesce(excluded.avatar_url, profiles.avatar_url),
    display_name = coalesce(excluded.display_name, profiles.display_name);
  return new;
end $$;

-- Backfill active party_member_board rows with current profile avatars
update public.party_member_board b
set avatar_url = p.avatar_url
from public.party_members m
join public.profiles p on p.id = m.user_id
where m.id = b.entry_id and p.avatar_url is not null;

notify pgrst, 'reload schema';
