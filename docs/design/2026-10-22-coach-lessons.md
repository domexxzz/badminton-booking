# Design: lessons with a coach

Status: proposed, 2026-10-22. Needs the owner's approval because it adds migration 0019.

## Why

Coaches already teach at the venue, but a lesson is arranged by phone and the court is
booked separately. A customer who wants to learn cannot see who teaches, when, or for how
much, and the shop has no record of what it owes each coach.

## What it does

- A coach account (`profiles.is_coach`, granted by an admin as today) opens `/coach` and
  writes their own listing: name shown to customers, a short bio, the lesson fee per hour,
  and whether they are taking bookings. They also set their weekly teaching hours.
- A customer opens `/coaches`, picks a coach, picks how long (1, 1.5, 2 or 3 hours) and a
  day, and sees only the start times that are free: inside the coach's hours, inside the
  venue's opening hours, with the coach free and at least one court free.
- Booking a lesson holds a free court the usual way and puts the lesson fee in the same
  bill. The customer pays by slip exactly as for any booking; nothing about payment,
  slip review, cancelling or refunds changes.
- The coach sees their upcoming lessons with the student's name and phone, and what the
  shop still owes them.
- The shop sees the same list at `/admin/coaches` and records paying a coach with one tap.

## Money

The customer pays court price + lesson fee in one bill, to the shop, through the existing
QR and slip flow. The shop then hands the lesson fee to the coach off-site and records it
with `coach_paid_at`. The site never pays a coach and never splits a transfer.

A lesson fee is whole baht, 0–5000 per hour, set by the coach. `lesson_fee` is stored on the
booking so a later change to the coach's price does not change an existing bill.

## Not in scope

- No per-lesson prices or packages, no recurring weekly lessons, no group classes with
  several students on one bill.
- No payouts through the site, no commission or revenue split.
- No ratings or reviews, no chat between customer and coach.
- No moving a lesson: the coach agreed to that time, so a customer cancels and books again.
  The shop may still move one by hand.

## How it is built

- `coach_profiles` (one row per coach) and `coach_availability` (weekly hours, Bangkok,
  half-hour steps). Both read-only to clients; writes go through RPCs.
- `bookings` gains `coach_id`, `lesson_fee` and `coach_paid_at`. The booking is otherwise an
  ordinary booking, which is what keeps payment and refunds unchanged.
- A coach cannot be booked twice at the same time: an exclusion constraint on
  (`coach_id`, time range), the same mechanism that stops double-booked courts. A court the
  coach booked to play on themselves makes them busy too, which only `coach_busy()` knows.
- `create_lesson_booking` takes an advisory lock per coach, checks the hours and that the
  coach is free, then calls the existing `create_cart_booking` for the first free court.
- Every write is a `SECURITY DEFINER` RPC with `search_path = public`. A coach may edit only
  their own listing and hours; only an admin records a pay-out.
- `coach_open_starts` is readable by anyone (it shows free times, never who booked what).
  A coach's listing is public only while they are taking bookings; a customer who booked
  them keeps seeing it.

## Files

- `supabase/migrations/0019_coach_lessons.sql`, covered in `scripts/test-db.mjs`
- `src/app/coach-actions.ts`, `src/lib/coach.ts` (+ `test/coach.test.ts`)
- `src/app/(customer)/coaches/`, `src/app/(customer)/coach/`, `src/components/coach/`
- `src/app/admin/coaches/`, `src/components/admin/MarkCoachPaidButton.tsx`
- Links from `/me` and a "🎓 โค้ช" tab in the admin nav
