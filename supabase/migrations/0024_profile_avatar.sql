-- 0024_profile_avatar.sql
-- Save and sync customer avatar (e.g. from LINE Login profile) and mirror to party member board.

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

-- Mirror avatar_url to party_member_board so public room board shows player photos.
alter table public.party_member_board
  add column if not exists avatar_url text;

update public.party_member_board b
set avatar_url = p.avatar_url
from public.party_members m
join public.profiles p on p.id = m.user_id
where m.id = b.entry_id;

create or replace function public.sync_party_public_board() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_room party_rooms;
begin
  v_room := case when tg_op = 'DELETE' then old else new end;
  if tg_op <> 'DELETE' and v_room.status = 'open' and v_room.ends_at > now() then
    insert into party_room_board (party_id, host_name, title, mode, capacity, court_id, starts_at, ends_at)
    values (v_room.id, v_room.host_name, v_room.title, v_room.mode,
            v_room.capacity, v_room.court_id, v_room.starts_at, v_room.ends_at)
    on conflict (party_id) do update set
      host_name = excluded.host_name, title = excluded.title, mode = excluded.mode,
      capacity = excluded.capacity, court_id = excluded.court_id,
      starts_at = excluded.starts_at, ends_at = excluded.ends_at;

    insert into party_member_board (entry_id, party_id, name, slot_no, joined_at, team, avatar_url)
    select m.id, m.party_id, m.name, m.slot_no, m.joined_at, m.team, p.avatar_url
    from party_members m
    left join profiles p on p.id = m.user_id
    where m.party_id = v_room.id and m.status = 'active'
    on conflict (entry_id) do update set
      name = excluded.name,
      slot_no = excluded.slot_no,
      team = excluded.team,
      avatar_url = excluded.avatar_url;
  else
    delete from party_member_board where party_id = v_room.id;
    delete from party_room_board where party_id = v_room.id;
  end if;
  return coalesce(new, old);
end $$;

create or replace function public.sync_party_member_board() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_row party_members := case when tg_op = 'DELETE' then old else new end;
  v_avatar text;
begin
  if tg_op <> 'DELETE' and v_row.status = 'active'
     and exists (select 1 from party_rooms where id = v_row.party_id and status = 'open' and ends_at > now()) then
    select avatar_url into v_avatar from profiles where id = v_row.user_id;
    insert into party_member_board (entry_id, party_id, name, slot_no, joined_at, team, avatar_url)
    values (v_row.id, v_row.party_id, v_row.name, v_row.slot_no, v_row.joined_at, v_row.team, v_avatar)
    on conflict (entry_id) do update set
      name = excluded.name,
      slot_no = excluded.slot_no,
      team = excluded.team,
      avatar_url = excluded.avatar_url;
  else
    delete from party_member_board where entry_id = v_row.id;
  end if;
  return coalesce(new, old);
end $$;

notify pgrst, 'reload schema';
