# Design: ก๊วน rooms and player membership

Status: proposed, 2026-10-23. Nothing is built yet. Needs the owner's approval: it adds a
migration and a new way for money to reach the shop.

## Why

Players who want a game today find one in a LINE group: someone posts "ขาด 2 คน 19:00", people
reply, the host counts heads by hand and chases everyone for their share. The shop sees none of
it, and a ก๊วน that falls apart leaves a booked court empty.

A room on the site is that LINE post, except the court is already booked and paid for, the count
is automatic, and the shop can see which nights fill and which do not.

The shop sells a **player membership**: a monthly fee to join rooms. Court time is paid
separately, exactly as it is today, so this adds revenue without taking any from court hire.

## What it does

- A customer who has a **confirmed booking** opens a room on it: a title, the nickname shown to
  others, how many players the ก๊วน needs, and whether joins are approved by hand or open to all.
- Anyone can browse open rooms at `/rooms` and see the court, the time, and how many spots are
  left. Logged out too.
- A logged-in player asks to join. The **host approves or declines** each request themselves —
  this is the room leader role; no admin is involved.
- The room page shows the host what the court costs and roughly what each approved player owes
  (`bill total ÷ approved players`). That is a number on a screen, nothing more: see Money.
- The host closes the room when the ก๊วน is full or called off. Cancelling the booking closes the
  room by itself, so a room never points at a court nobody holds.
- **Membership** gates how often a player may join. A free account gets one approved join per
  calendar month; a member joins as often as they like.

## Money

The membership fee is the only money this feature adds, and it is small: at 100 members and
฿59/month it is about ฿5,900/month, the same as selling 1.5 extra court-hours a day. The
feature earns its keep by filling courts that would otherwise sit empty, not by the fee.

**Court fees do not change.** The host pays the whole bill through the existing QR-and-slip
flow, as any customer does today, and collects each player's share themselves. The site never
splits a transfer and never holds money for one player on behalf of another. Adding that would
mean per-player billing, partial refunds and a much larger surface on the money path, which is
out of scope here.

Starting prices, to be confirmed against real numbers after the free period:

| | Free | Member ฿59/month (or ฿149/3 months) |
|---|---|---|
| See open rooms | yes | yes |
| Ask to join | 1 approved join per month | unlimited |
| See a new room | after 1 hour | at once |
| Book a court ahead | 14 days | 21 days |

The two perks at the bottom cost the shop nothing. A discount on court hire would come straight
out of the main revenue and is deliberately not offered.

**Rollout:** open everything free for the first one or two months. At launch there are no rooms,
so nobody would pay to join one, and we have no idea yet how many rooms a week this venue
actually produces. Count rooms opened and join requests over that period, then set the gate and
the price from what those numbers say. Build the membership tables from the start; just leave
every account a member until the shop decides to switch the gate on.

## Goals

- A ก๊วน that would have been organised in LINE happens on the site instead, with the court
  already paid for.
- The host spends less effort than they do now: no counting heads, no chasing a list.
- The shop can see which nights fill, to decide where a ก๊วน night is worth promoting.

## Non-goals

- No splitting a payment between players, and no per-player refunds.
- No recurring card billing. Thai PromptPay has no auto-debit here, and the site's only payment
  path is QR plus a slip an admin reviews. An admin grants and renews a membership by hand.
- No chat, no ratings, no skill levels, no automatic matching.
- No rooms without a booking behind them.

## Anti-goals

Things that would make this a failure even if it worked:

- Making the ordinary booking flow heavier for the many customers who never join a ก๊วน.
- A room holding a court that nobody has paid for.
- Leaking who is playing with whom. Names of players are not public.
- Becoming a worse LINE group: if the site only announces a game and does not count heads,
  track who paid and clean up after itself, nobody has a reason to pay for it.

## Decisions made here (owner can overrule any of these)

1. **A room is always tied to one confirmed booking bill** (`bookings.group_id`), not free-floating.
   It is what makes the room real, it gives the host something to lose, and it reuses the court,
   the time and the amount the booking already holds.
2. **The host collects the court money themselves.** See Money.
3. **A non-member sees counts, not names.** The public room list carries the court, the time, the
   title, the host's chosen nickname and the number of spots left. The list of who is in the room
   is visible to the host and to approved players only — the same line the play queue draws
   between `queue_entries` and `queue_board`.
4. **One approved join per month on a free account**, counted by Bangkok calendar month.
5. **Starting price ฿59/month**, under the cost of one ก๊วน session (฿50–65 a head today), so the
   decision needs no arithmetic.

## How it is built

Same shape as the play queue (0018) and lessons (0019): private tables hold the user ids, a
public mirror carries no PII, every write goes through a `SECURITY DEFINER` RPC with
`search_path = public`, and RLS is on everywhere.

- `play_rooms` — one row per room: host, the `group_id` it sits on, title, host nickname, how many
  players are wanted, join policy, status. Private; the public list comes from the mirror.
- `room_requests` — one row per player per room: status (`pending`, `approved`, `rejected`,
  `left`), who decided and when. Holds the user id, so it is private to the player, the host and
  admins. A unique index allows one live request per player per room.
- `room_board` — public, PII-free mirror kept by a trigger and published to realtime: room id,
  court names, start and end, title, host nickname, spots wanted, spots taken, status.
- `memberships` — user id, `expires_at`, who granted it. A `has_membership()` helper reads it.
- A trigger on `bookings`: when the bill behind a room stops being confirmed, the room closes and
  its pending requests are withdrawn.

RPCs: `open_room`, `close_room`, `request_join`, `decide_request` (host or admin), `leave_room`,
and `set_membership` (admin only). `request_join` is where the free-tier count and the room's
capacity are checked, inside the same transaction, so two players cannot take the last spot.

Pages: `/rooms`, `/rooms/[id]` (join, and the host's approve screen), `/rooms/new`, membership
status on `/me`, and `/admin/members` for granting and renewing.

## Left to the builder

- Whether the room list needs filters (day, court, time of day) at launch, or whether a plain
  list ordered by start time is enough while there are few rooms.
- How a player is told their request was approved. LINE already notifies the shop
  (`src/lib/line/`); reusing it for players is possible but is its own piece of work.
- Where to show the per-head estimate on the room page without it reading as something the site
  will collect.

## Open questions for the owner

1. Should a member get anything the free tier does not, beyond joining more often? The two perks
   above are guesses that cost nothing; a real one might sell better.
2. When the shop switches the gate on, do existing free accounts keep their old access for a
   while, or does everyone start fresh?
