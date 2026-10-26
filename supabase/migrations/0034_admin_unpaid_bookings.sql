-- 0034_admin_unpaid_bookings.sql
--
-- Phone, LINE and walk-in bookings an admin enters are confirmed straight away. A ก๊วน
-- that books by phone often pays later — at the counter, or for the month in one go — so
-- the admin can now record such a booking as owed.
--
-- "Owed" is the same pay-later state coaches already use (0014): pay_later = true and no
-- paid_at. So the board's "ค้างชำระ" list, mark_booking_paid() to settle it, revenue
-- (which leaves owed bookings out) and the daily summary all treat it the same way.
-- Nothing about prices, holds or slips changes, and customers' own online bookings —
-- paid by slip — can never be switched to owed.
--
-- Numbered 0034 to follow the guilds migration (0033, still in review); it does not depend
-- on it and can be run on its own.

create or replace function public.admin_mark_booking_unpaid(p_booking_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_group uuid;
begin
  if not is_admin() then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;
  select group_id into v_group from bookings
    where id = p_booking_id and channel <> 'online' and status = 'confirmed';
  if not found then
    raise exception 'BOOKING_NOT_FOUND' using errcode = 'P0002';
  end if;
  -- The whole bill: a booking entered for several courts is owed as one.
  update bookings set pay_later = true, paid_at = null
  where (id = p_booking_id or (v_group is not null and group_id = v_group))
    and channel <> 'online' and status = 'confirmed';
end $$;

revoke execute on function public.admin_mark_booking_unpaid(uuid) from public, anon;
grant execute on function public.admin_mark_booking_unpaid(uuid) to authenticated;

notify pgrst, 'reload schema';
