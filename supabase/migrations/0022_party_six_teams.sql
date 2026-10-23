-- Six fixed Party teams with two member slots each:
-- A=1-2, B=3-4, C=5-6, D=7-8, E=9-10, F=11-12.

alter type public.party_team add value if not exists 'C';
alter type public.party_team add value if not exists 'D';
alter type public.party_team add value if not exists 'E';
alter type public.party_team add value if not exists 'F';

create or replace function public.party_team_slot_valid(p_team public.party_team, p_slot_no smallint)
returns boolean language sql immutable set search_path = public as $$
  select p_slot_no between 1 and 12
    and ((p_slot_no - 1) / 2) + 1 = array_position(array['A','B','C','D','E','F'], p_team::text)
$$;

create or replace function public.join_party(p_party_id uuid, p_name text, p_slot_no smallint, p_team public.party_team)
returns public.party_members
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_room party_rooms; v_row party_members; v_name text := clean_party_text(p_name, 30);
begin
  if v_uid is null then raise exception 'LOGIN_REQUIRED' using errcode = '42501'; end if;
  select * into v_room from party_rooms where id = p_party_id for update;
  if not found or v_room.status <> 'open' or v_room.ends_at <= now() then raise exception 'PARTY_NOT_OPEN' using errcode = '22023'; end if;
  if v_name is null or p_team is null or p_slot_no is null or p_slot_no > v_room.capacity or not party_team_slot_valid(p_team, p_slot_no) then raise exception 'INVALID_PARTY_DETAILS' using errcode = '22023'; end if;
  if (select count(*) from party_members where party_id = p_party_id and status = 'active') >= v_room.capacity then raise exception 'PARTY_FULL' using errcode = '22023'; end if;
  begin insert into party_members (party_id, user_id, name, slot_no, team) values (p_party_id, v_uid, v_name, p_slot_no, p_team) returning * into v_row;
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
  if p_team is null or p_slot_no > v_capacity or not party_team_slot_valid(p_team, p_slot_no) then raise exception 'INVALID_PARTY_DETAILS' using errcode = '22023'; end if;
  begin update party_members set slot_no = p_slot_no, team = p_team where id = p_entry_id returning * into v_row;
  exception when unique_violation then raise exception 'PARTY_SLOT_TAKEN' using errcode = '23505'; end;
  return v_row;
end $$;

revoke execute on function public.party_team_slot_valid(party_team, smallint) from public, anon, authenticated;
notify pgrst, 'reload schema';
