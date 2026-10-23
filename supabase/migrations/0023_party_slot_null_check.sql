-- 0023_party_slot_null_check.sql
-- move_party_slot() lets a null slot through its guard.
--
-- `p_slot_no > v_capacity` is null when p_slot_no is null, and
-- `party_team_slot_valid(team, null)` is null as well, so `not null` is null too.
-- The whole OR is then null, which is not true, and the guard passes. The update
-- that follows hits the NOT NULL column and the customer sees a raw 23502 instead
-- of the Thai message. join_party() already checks for this; this is the same
-- check in the one place it was missed.

create or replace function public.move_party_slot(p_entry_id uuid, p_slot_no smallint, p_team public.party_team)
returns public.party_members
language plpgsql security definer set search_path = public as $$
declare v_row party_members; v_capacity smallint;
begin
  select m.* into v_row from party_members m join party_rooms r on r.id = m.party_id where m.id = p_entry_id and m.user_id = auth.uid() and m.status = 'active' and r.status = 'open' for update of m;
  if not found then raise exception 'PARTY_MEMBER_NOT_FOUND' using errcode = 'P0002'; end if;
  select capacity into v_capacity from party_rooms where id = v_row.party_id;
  if p_team is null or p_slot_no is null or p_slot_no > v_capacity or not party_team_slot_valid(p_team, p_slot_no) then raise exception 'INVALID_PARTY_DETAILS' using errcode = '22023'; end if;
  begin update party_members set slot_no = p_slot_no, team = p_team where id = p_entry_id returning * into v_row;
  exception when unique_violation then raise exception 'PARTY_SLOT_TAKEN' using errcode = '23505'; end;
  return v_row;
end $$;

notify pgrst, 'reload schema';
