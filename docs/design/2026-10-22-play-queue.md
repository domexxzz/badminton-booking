# Design: booking-backed Party queue (คิวก๊วน)

Status: replaced by the Party model in migration 0020. Owner approved on 2026-10-23.

## Party model (0020)

- The customer-facing name stays “คิวก๊วน”.
- A host chooses a court, date, start time and duration, then pays the normal court booking in full.
- The room remains private while payment is pending and opens publicly only after the booking is confirmed.
- Hosting is free during launch. `can_host_party()` is the single switch for a future subscription check.
- Guests join free in the app. Any cost sharing is agreed and paid directly to the host; the shop does not collect it.
- A room can be singles or doubles and has 12 numbered slots. In doubles, adjacent slots form a fixed team.
- Members choose and move their own slot. The host occupies slot 1 initially and may remove other members.
- The app produces 15-minute round-robin matches and repeats the rotation until the booked time is full.
- Public realtime mirror tables contain display names and slot numbers, but no account user IDs.

## Previous queue model (0018, retained for migration history)

On a ก๊วน night players stand around a court and someone keeps the order on paper. Players
want to see where they are without asking, and the person running the court wants one tap to
send the next group on.

## What it does

- An admin opens a queue on a court (`/admin/queue`) and sets how many players go on per game
  (2 for singles, 4 for doubles).
- Anyone can watch the queue live at `/queue`, logged in or not. It shows who is playing and
  the waiting order.
- A logged-in customer joins with a nickname (default: their display name). The nickname is
  shown to everyone, and the page says so. One active place per person across all courts.
- The customer can leave the queue. After a game they can join again at the back.
- The admin can: call the next game (current players finish, the next N waiting go on), add a
  walk-in by name, put a player straight on, send a player to the back, or remove them.
- Closing a queue ends every place in it.

## Not in scope

- No money. The queue does not book or bill anything; court time is still booked as today.
- No score keeping, no winner-stays rule (the admin uses "send to back" for that), no
  notification when your turn comes.
- No organiser role: only admins run the queue.

## How it is built

Same pattern as `bookings` → `court_occupancy`:

- `court_queues` (one row per court): `is_open`, `players_per_game`. Public read.
- `queue_entries`: private (owner or admin can read), holds `user_id`.
- `queue_board`: public, PII-free mirror kept by a trigger, in the realtime publication. It has
  only the entry id, court, nickname, status and times, never a user id.
- Every write goes through a `SECURITY DEFINER` RPC with `search_path = public`. Admin RPCs
  check `is_admin()`.
- Places left over from an earlier day (admin forgot to close) are ended automatically the next
  time anyone uses the queue.
- Limits: nickname 1–30 characters; at most 20 joins per person per hour; one active place per
  person (unique index).

## Files

- `supabase/migrations/0018_play_queue.sql`, covered in `scripts/test-db.mjs`
- `src/app/queue-actions.ts` (server actions)
- `src/app/(customer)/queue/page.tsx`, `src/components/queue/*`
- `src/app/admin/queue/page.tsx`
- Bottom nav and admin nav get a "คิวก๊วน" tab
