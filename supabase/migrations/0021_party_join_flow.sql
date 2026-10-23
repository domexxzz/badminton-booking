-- Add an explicit team to Party members. Opening a room remains read-only;
-- membership is created only when a player confirms a free slot and team.

create type public.party_team as enum ('A', 'B');

alter table public.party_members
  add column team public.party_team;
update public.party_members set team = case when slot_no % 2 = 1 then 'A'::party_team else 'B'::party_team end;
alter table public.party_members alter column team set not null;
alter table public.party_members alter column team set default 'A'::party_team;

alter table public.party_member_board add column team public.party_team;
update public.party_member_board b set team = m.team from public.party_members m where m.id = b.entry_id;
alter table public.party_member_board alter column team set not null;
alter table public.party_member_board alter column team set default 'A'::party_team;

create or replace function public.sync_party_member_board() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_row party_members := case when tg_op = 'DELETE' then old else new end;
begin
  if tg_op <> 'DELETE' and v_row.status = 'active'
     and exists (select 1 from party_rooms where id = v_row.party_id and status = 'open' and ends_at > now()) then
    insert into party_member_board (entry_id, party_id, name, slot_no, joined_at, team)
    values (v_row.id, v_row.party_id, v_row.name, v_row.slot_no, v_row.joined_at, v_row.team)
    on conflict (entry_id) do update set name = excluded.name, slot_no = excluded.slot_no, team = excluded.team;
  else
    delete from party_member_board where entry_id = v_row.id;
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists party_members_sync_board on public.party_members;
create trigger party_members_sync_board after insert or update of status, name, slot_no, team
  on public.party_members for each row execute function public.sync_party_member_board();

-- Replace the original three-argument join so every new member explicitly chooses a team.
drop function public.join_party(uuid, text, smallint);
create or replace function public.join_party(p_party_id uuid, p_name text, p_slot_no smallint, p_team public.party_team)
returns public.party_members
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_room party_rooms; v_row party_members; v_name text := clean_party_text(p_name, 30);
begin
  if v_uid is null then raise exception 'LOGIN_REQUIRED' using errcode = '42501'; end if;
  select * into v_room from party_rooms where id = p_party_id for update;
  if not found or v_room.status <> 'open' or v_room.ends_at <= now() then raise exception 'PARTY_NOT_OPEN' using errcode = '22023'; end if;
  if v_name is null or p_team is null or p_slot_no is null or p_slot_no < 1 or p_slot_no > v_room.capacity then raise exception 'INVALID_PARTY_DETAILS' using errcode = '22023'; end if;
  if (select count(*) from party_members where party_id = p_party_id and status = 'active') >= v_room.capacity then raise exception 'PARTY_FULL' using errcode = '22023'; end if;
  begin
    insert into party_members (party_id, user_id, name, slot_no, team) values (p_party_id, v_uid, v_name, p_slot_no, p_team) returning * into v_row;
  exception when unique_violation then
    if exists (select 1 from party_members where party_id = p_party_id and user_id = v_uid and status = 'active') then raise exception 'ALREADY_IN_PARTY' using errcode = '23505'; end if;
    raise exception 'PARTY_SLOT_TAKEN' using errcode = '23505';
  end;
  return v_row;
end $$;

create or replace function public.move_party_slot(p_entry_id uuid, p_slot_no smallint, p_team public.party_team)
returns public.party_members
language plpgsql security definer set search_path = public as $$
declare v_row party_members; v_capacity smallint;
begin
  select m.* into v_row from party_members m join party_rooms r on r.id = m.party_id where m.id = p_entry_id and m.user_id = auth.uid() and m.status = 'active' and r.status = 'open' for update of m;
  if not found then raise exception 'PARTY_MEMBER_NOT_FOUND' using errcode = 'P0002'; end if;
  select capacity into v_capacity from party_rooms where id = v_row.party_id;
  if p_team is null or p_slot_no < 1 or p_slot_no > v_capacity then raise exception 'INVALID_PARTY_DETAILS' using errcode = '22023'; end if;
  begin update party_members set slot_no = p_slot_no, team = p_team where id = p_entry_id returning * into v_row;
  exception when unique_violation then raise exception 'PARTY_SLOT_TAKEN' using errcode = '23505'; end;
  return v_row;
end $$;

revoke execute on function public.join_party(uuid, text, smallint, party_team) from public, anon;
revoke execute on function public.move_party_slot(uuid, smallint, party_team) from public, anon;
grant execute on function public.join_party(uuid, text, smallint, party_team) to authenticated;
grant execute on function public.move_party_slot(uuid, smallint, party_team) to authenticated;

notify pgrst, 'reload schema';
