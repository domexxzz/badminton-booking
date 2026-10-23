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
- **Membership** gates how often a player may join. Every account gets one free join to try the
  thing; after that a player buys a day pass or a month.

## Money

The membership fee is the only money this feature adds. At 100 members on ฿149/month it is
about ฿14,900/month, the same as selling nearly 4 extra court-hours a day — a real line of
revenue, not a rounding error. It still only works if the rooms are worth joining; the fee
follows the value, it does not create it.

**Court fees do not change.** The host pays the whole bill through the existing QR-and-slip
flow, as any customer does today, and collects each player's share themselves. The site never
splits a transfer and never holds money for one player on behalf of another. Adding that would
mean per-player billing, partial refunds and a much larger surface on the money path, which is
out of scope here.

Prices, set by the owner on 2026-10-23, to be confirmed against real numbers after the free period:

| | Free | Day pass ฿29 | Month ฿149 |
|---|---|---|---|
| See open rooms | yes | yes | yes |
| Ask to join | once per account, ever | unlimited that day | unlimited |
| See a new room | after 1 hour | after 1 hour | at once |
| Book a court ahead | 14 days | 14 days | 21 days |

The two perks at the bottom cost the shop nothing. A discount on court hire would come straight
out of the main revenue and is deliberately not offered.

The two prices sit ฿149 ÷ ฿29 ≈ **5.1 days** apart, so a player who comes six times a month or
more is better off on the month, and a casual player is better off paying by the day. That is
the right way round: ก๊วน regulars play 8–13 times a month and will take the month, which is the
subscription the shop wants.

What each costs a player on top of court time is worth keeping in view. A ก๊วน session costs a
player ฿50–65 for the court today:

| | Membership per session | On top of court |
|---|---|---|
| Month ฿149, played 10× | ฿14.90 | +25% |
| Month ฿149, played 5× | ฿29.80 | +50% |
| Day pass ฿29 | ฿29.00 | +48% |

The month is comfortable for a regular. The day pass is a heavy add-on for someone playing
once — close to half the price of the court again — so the one free join matters: it is how a
casual player finds out the room is worth ฿29 before being asked for it.

**How a membership is bought** (owner's decision, 2026-10-23): both the day pass and the month
are bought on the site, the same way a court is — transfer, attach the slip, an admin approves.
Nothing is sold at the counter.

That gives the shop one way of taking money instead of two, and every baht lands in the same
place with a slip behind it. The cost is that **a membership is not instant**. A player who
wants to join a room right now has to transfer, upload, and wait for an admin to look. The month
does not care: it is bought the night before. The day pass does — it is the purchase someone
makes while standing at the court. Two things follow from that, and the build should carry both:

- The shop should be told the moment a membership slip arrives, the way it already is for a
  booking slip (`src/lib/line/notify-shop.ts`), so approval is minutes rather than hours.
- `/admin/members` should be one tap from that alert, showing the slip and the amount, with one
  button to approve.

If approving in time turns out to be a problem in practice, the cheapest fix is to let the
existing EasySlip check look at a membership slip too. The amounts are fixed (฿29 and ฿149) and
the stakes are small, so auto-approving one is a much easier decision than auto-confirming a
court booking. That is not in this design; it is where to go if the queue at the counter is real.

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
4. **The free allowance is one join per account, ever — not one a month.** A monthly free join
   would undercut the ฿29 day pass: a player who comes once a month would never need to buy one.
   One free join to try, then pay, keeps the day pass worth selling. Agreed with the owner on
   2026-10-23, along with the prices.

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
- `memberships` — user id, `expires_at`, who granted it, and the free join the account has used.
  One table covers both products: a day pass is a row expiring at the end of that Bangkok day, a
  month is the same row a month out. A `has_membership()` helper is the only thing the join path
  asks.
- `membership_orders` — one row per purchase: who, which plan, the amount, the slip path, and
  the review status, mirroring `payments` but for a purchase that is not a booking. The existing
  `payments` table hangs off `booking_id` and the `slips` bucket's policy only accepts a path
  shaped like a booking's, so a membership slip needs its own row and its own storage path.
  Approving an order is what writes `memberships.expires_at`; approving twice must not extend
  twice.

This is the one place the feature touches money, and it adds a second payment path to a site
that has had exactly one. Everything about it should copy the booking path rather than invent:
same bucket conventions, same "a slip is reviewed by a human" rule, same refusal to let an
automatic check confirm anything on its own.
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

1. Should a month give anything a day pass does not, beyond lasting longer? The two perks above
   are guesses that cost nothing; a real one might sell better, and the month needs to feel like
   more than five day passes stapled together.
2. When the shop switches the gate on, do existing free accounts keep their old access for a
   while, or does everyone start fresh?
3. Should an admin be able to extend or cancel a membership by hand as well as by approving an
   order — for a refund, a mistake, or a free month given to someone who complained?
