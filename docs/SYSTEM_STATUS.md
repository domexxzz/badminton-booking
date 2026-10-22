# System status: badminton-booking (แบดมินตัน@สินธานี)

As of **2026-10-22**, `main` at `43f5077`. This file is the current source of truth.
`PROJECT_HANDOFF.md` is older and partly out of date (it still says Vercel, ฿150, and older test counts).

Read `AGENTS.md` before changing anything. It lists which files need the owner's (โดม) approval.

> This repository is **public**. Nothing here may contain a key, a token, a password or a
> customer's personal data — only variable names and behaviour.

---

## 1. What it is

A badminton court booking site with 4 courts. Customers book, pay through a Bangkok Bank
merchant QR, and upload a slip. An admin reviews each slip and confirms the booking.
Customers pay real money, so keep changes small and safe.

Two things ride on top of that: a **play queue** (คิวก๊วน) for lining up at a court on a
ก๊วน night, and **lessons with a coach**, where the lesson fee is part of the same bill.

| | |
|---|---|
| Live site | https://badminton-booking-ihw1.onrender.com (admin: `/admin`) |
| Hosting | Render, Singapore, **Starter** plan (`render.yaml`). Every push to `main` builds and deploys, about 1–4 minutes. |
| Database | Supabase project `ktecjmuyrufzkxoidrnc` (Postgres + Auth + Storage + Realtime) |
| Repo | https://github.com/domexxzz/badminton-booking (public) |
| Old host | `badminton-booking-steel.vercel.app` is dead. Nothing should link to it. |
| Stack | Next.js 15.5 (App Router, Server Actions), React 19, Supabase SSR, Vitest, PGlite for DB tests |

**Local dev uses the live database.** There is no staging database. Never create bookings,
press admin buttons, or run SQL against it while testing.

---

## 2. State on 2026-10-22

Everything below is live and verified unless marked otherwise.

### Shipped
- **PR #15** — the slip check now compares the receiver account, the receiver name and the
  transfer time, not only the amount.
- **PR #16** — customer pages read courts, opening hours and the shop contact from a shared
  60-second cache (`src/lib/public-data.ts`). Measured on the live site at 50 concurrent
  users: median page time 1.19s → 0.60s, throughput 24.8 → 31.7 pages/s, 0% errors.
- **PR #20** — the receiver check understands a **bill payment**: EasySlip reports the
  receiver of a merchant-QR payment as proxy type `BILLERID` with a masked biller ID and no
  bank account at all. Matched against `SLIP_RECEIVER_BILLER_ID`, defaulting to the biller ID
  of the merchant QR in `promptpay.ts`.
- **PR #21 (Ta)** — cart booking: several courts at several times in one bill, for customers
  and for admins, with migration `0017_multi_slot_bookings.sql`.
- **PR #22** — repaired `adminUploadSlipFile` after #21: `status` was no longer selected (so
  every admin slip upload failed, and the type error broke the build), `ext` was declared
  twice, and the early return for an already-confirmed booking was gone, which pushed a paid
  booking back into the review queue where a reject could cancel it. The decision now lives in
  `planAdminSlipUpload()` with tests.
- **PR #23** — migration 0017 declared `p_channel booking_channel`, a type this project has
  never had (`bookings.channel` is text with a check constraint, from 0001), so the migration
  failed at its first statement. Fixed to `text`, and 0017 added to the migration list in
  `scripts/test-db.mjs`, which had stopped at 0016 — that gap is why it was never caught.
- **PR #26** — the **play queue** and **lessons with a coach**, with migrations 0018 and 0019
  (see §7). PR #27 (lessons) was opened on top of the queue branch and merged into it first,
  so #26 carried both features to `main` in one deploy. Both migrations had already been run
  and checked on the live database, so the code and the schema never disagreed.

### Email sign-in (rebuilt today)
Email login was completely broken and is now working end to end:
- Supabase **Site URL** still pointed at the dead Vercel domain, so every sign-in link landed
  on a paused page. Now the Render domain; the old Vercel entry was removed from Redirect URLs.
- The built-in Supabase mailer allows **2 emails/hour** for the whole project. Custom SMTP
  (Brevo, free tier ~300/day) is now configured, and the Supabase rate limit raised to 100/h.
- The **Magic link** and **Confirm sign up** templates now use
  `{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=email`, so a link opens in any browser or
  in the Gmail/LINE in-app browser. The default link only worked in the browser that asked for it.
- `TYPHOON_API_KEY` was removed from Render and must never be added back: slip checks must
  go through EasySlip (real bank data) instead of an LLM reading the image.

### Not finished
1. **Neither new feature has been used by a real person yet.** Both pages load on the live site
   and show the right empty state (`/queue`: "ยังไม่มีสนามเปิดคิวก๊วน", `/coaches`: "ยังไม่มีโค้ช
   เปิดรับสอน"), but no queue has been opened, no coach listing written, and no lesson booked.
   §8 lists what to try first.
2. **Multi-time cart booking is not proven end to end.** A test booking of 4 courts went
   through as one ฿520 bill, but all four were at the same time, which the old path already
   did. No booking with a different time per court has been seen in the database yet.
3. **`adminUploadSlipFile` has not been exercised since PR #22.** Attach a slip to a confirmed
   booking and check it stays `confirmed`, and to an unpaid one and check it reaches the review queue.
4. **The BILLERID check has not met a real slip yet.** Every slip checked so far predates the
   fix, and a slip is only re-checked while its booking is `awaiting_review`.
5. **Live price is ฿130/hour (฿65 per 30 min)**, from `courts.price_per_hour`.
   `src/lib/config.ts` still says 150; that value is display and fallback only. Confirm which
   is intended before changing either side.

### Known gaps
- **`main` has no branch protection.** Collaborators can push or merge straight to production,
  and merging to `main` deploys.
- **There is no CI.** No workflow in `.github/`, so nothing runs the tests on a PR. The four
  commands in §6 are the only gate, and they only run if someone runs them.
- **A stacked PR is easy to merge in the wrong order.** PR #27 was opened against the queue
  branch, not `main`; merging it looked like shipping the feature but changed nothing on the
  live site. Check the base branch on the PR page before merging.
- No security headers (CSP, HSTS, X-Frame-Options, nosniff) in `next.config.mjs`.
- No rate limiting on server actions or email OTP. The only limits are in the database:
  6 bookings/hour, 4 open bookings per user, and 20 queue joins per hour.
- An `awaiting_review` booking never expires, so a junk slip holds a court until an admin acts.
- The bank webhook (`/api/bank-notifications`) returns 503 until `BANK_WEBHOOK_SECRET` (32+
  chars) and `BANK_APP_PACKAGES` are set. It never confirms a booking by itself.
- If the shop cancels a lesson after recording the coach pay-out, the pay-out is not reversed.
- `npm audit` reports postcss (via Next), build-time only, low risk.
- Supabase backups: not verified. Check Database → Backups.
- **The owner's Windows machine runs out of commit memory**, and then `npm run build` dies with
  `spawn UNKNOWN` or "build worker exited", while `npm test` and `npm run test:db` die with
  `Zone Allocation failed`. This is the machine, not the code. Set
  `$env:NODE_OPTIONS = "--max-old-space-size=1024"` before building, close some apps, or just
  retry — the tests pass on a later attempt once memory frees up.

---

## 3. How money flows (do not break)

1. A customer picks courts and times in `/book`. `create_cart_booking` (0017) holds them, or
   `create_multi_booking` (0012) when the cart RPC is unavailable — the code falls back on its
   own. Bookings share a `group_id`, which makes one bill. The hold lasts **5 minutes**.
2. The customer pays the merchant QR built in `src/lib/promptpay.ts` (`BBL_MERCHANT_PRO_QR`,
   with a dynamic amount).
3. The customer uploads a slip to the private `slips` bucket. `submit_slip` sets
   `awaiting_review` and clears the hold.
4. The optional auto-check (`verifyLatestSlip`) only **labels** the payment
   (`verify_status`, `verify_reasons`). It never confirms anything.
5. An admin approves in `/admin/review` → `review_payment`, which checks `is_admin()`.
6. A customer can cancel until **12:00 on the booking day** (or until start, if earlier) with a
   refund QR or a typed bank account (`request_cancel`, 0016). An admin attaches the refund slip.

A **lesson** is an ordinary booking with a coach attached (0019), so every step above is
unchanged. The only difference is the bill: `amount` is court price **plus** `lesson_fee`, and
the page sends back the total it quoted, so nobody is charged a price they did not see. The
shop receives the whole amount and hands the lesson fee to the coach off-site; `coach_paid_at`
records that. The site never pays a coach and never splits a transfer.

Rules are enforced **in the database**, not only in the UI:
- No double booking: a `btree_gist` exclusion constraint on court and time range (race-safe).
  A coach is protected the same way, by a constraint on coach and time range.
- 30-minute steps, minimum 0.5h, maximum 4h online, at most 14 days ahead. A lesson is 1–3h.
- Opening hours come from `venue_settings`.
- Coaches (`profiles.is_coach`, granted by an admin) can pay later and enter an agreed price,
  never above list price.
- Every admin RPC checks `is_admin()` inside a `SECURITY DEFINER` function with
  `search_path = public`. RLS is on for every table.

---

## 4. Code map

| Area | Where |
|---|---|
| Customer pages | `src/app/(customer)/` — `/`, `/book`, `/schedule`, `/bookings/[id]`, `/me`, `/login`, `/queue`, `/coaches`, `/coaches/[id]`, `/coach` |
| Admin pages | `src/app/admin/` — dashboard, `review`, `board`, `new`, `requests`, `analytics`, `settings`, `team`, `queue`, `coaches` |
| Server actions | `src/app/actions.ts`, `request-actions.ts`, `admin-actions.ts`, `queue-actions.ts`, `coach-actions.ts` |
| Routes | `src/app/api/bank-notifications/`, `src/app/auth/callback`, `src/app/auth/line/*` |
| Slip check | `src/lib/slip/` — `easyslip.ts`, `evaluate.ts`, `check-record.ts`, `verify-booking.ts` |
| Admin slip rules | `src/lib/admin-slip.ts` |
| Cached public data | `src/lib/public-data.ts`, `src/lib/venue-rows.ts` |
| Play queue | `src/lib/queue.ts`, `src/lib/queue-data.ts`, `src/components/queue/`, `src/components/admin/AdminQueueCourt.tsx` |
| Lessons with a coach | `src/lib/coach.ts`, `src/components/coach/`, `src/components/admin/MarkCoachPaidButton.tsx` |
| Bank inbox / LINE | `src/lib/bank/`, `src/lib/line/` |
| Styles | `src/app/globals.css`; brand images in `public/brand/` |
| DB schema | `supabase/migrations/0001`–`0019`. 0016–0019 verified applied on live. |
| Design notes | `docs/design/2026-10-22-play-queue.md`, `docs/design/2026-10-22-coach-lessons.md` |

**Needs owner approval before changing** (from `AGENTS.md`): `supabase/migrations/**`,
`src/lib/supabase/**`, `src/app/api/**`, the three `*actions.ts`, `src/middleware.ts`,
`src/lib/slip/**`, `src/lib/bank/**`, `src/lib/line/**`, prices and hours in `config.ts`,
and any `.env*` file.

---

## 5. Environment variables (names only — never print or commit values)

| Variable | Needed for | If missing |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | everything | site fails to start |
| `SUPABASE_SERVICE_ROLE_KEY` | slip check, webhook, LINE login, admin slip upload | those features are off |
| `NEXT_PUBLIC_SITE_URL` | LINE callback, email links (read at **build** time — redeploy after changing) | LINE login off; email links point to localhost |
| `EASYSLIP_API_KEY` | automatic slip check | admin checks every slip by hand |
| `SLIP_RECEIVER_NAME` | receiver-name check | every slip shows "mismatch" |
| `SLIP_RECEIVER_BILLER_ID` | merchant-QR receiver check | falls back to the biller ID in `promptpay.ts` |
| `SLIP_RECEIVER_BANK_ACCOUNT` | plain bank-transfer receiver check | unused for merchant-QR slips |
| `PROMPTPAY_ID` | PromptPay proxy check | falls back to the other receiver checks |
| `LINE_LOGIN_CHANNEL_ID`, `LINE_LOGIN_CHANNEL_SECRET` | LINE Login | LINE login button off |
| `LINE_MESSAGING_TOKEN`, `LINE_NOTIFY_EVENTS` | LINE alerts | no LINE alerts |
| `BANK_WEBHOOK_SECRET`, `BANK_APP_PACKAGES` | money-in inbox from the shop phone | webhook returns 503 |
| `TYPHOON_API_KEY` | AI OCR fallback | removed from Render and must never be added back (keep unset): it overrides EasySlip and an edited image can fool it |

- **Supabase Auth → URL Configuration** must use the Render domain, and the Magic link and
  Confirm sign up templates must keep the `token_hash` link.
- **Supabase Auth → Rate Limits → sending emails** is 100/h and only works with custom SMTP.
- **LINE Developers** callback: `https://badminton-booking-ihw1.onrender.com/auth/line/callback`.

The queue and the lessons need no new variables.

---

## 6. Working rules

- Branch per change: `ui/<name>` for UI, `fix/…`, `perf/…`, `docs/…`, `feat/…` otherwise. Open a
  PR with a **Thai** description in plain words (a teammate who is not a developer reads it).
  Include before/after screenshots for UI changes.
- Do not push to `main`, deploy, or run SQL on the live database yourself. Merging to `main`
  **is** deploying, and a migration must be run by the owner in the Supabase SQL Editor —
  Render does not run it.
- Apply a migration **before** merging the code that needs it, then check it with read-only
  catalog queries. Note that `pg_get_function_identity_arguments()` returns parameter **names**
  as well as types, so a check comparing it against types alone always fails.
- Prefer one PR per feature, based on `main`. A PR stacked on another branch deploys nothing
  when merged.
- Mobile-first. Check at about 390px, light and dark.
- Before saying done: `npm test`, `npm run test:db` (must print `ALL PASSED`),
  `npx tsc --noEmit`, `npm run build`. All four are green at `43f5077` (188 unit tests).
- When a test is meant to catch a regression, break the fix on purpose once and confirm the
  test fails. Two bugs reached `main` on 2026-10-22 that a green suite had not covered.
- Load-test with read-only GETs of public pages only, and agree a time with the owner.

---

## 7. The two newest features

### Play queue (คิวก๊วน) — migration 0018
An admin opens a queue on a court at `/admin/queue`, sets how many players go on per game
(2, 3 or 4), and taps "เกมถัดไป" when a game ends: the players on court finish and the next
ones go on. They can also put one player on now, send someone to the back of the line, or add
a walk-in by name. Customers watch the line live at `/queue` and join with a nickname; the
card at the top shows their place and how many games are ahead. One active place per person.
Closing a queue ends every place in it, and a queue left open overnight clears itself the next
time anyone uses it.

No money is involved: the queue does not book a court and does not charge anything.

`queue_entries` holds the user id and is private to its owner and admins. `queue_board` is a
public, PII-free mirror kept by a trigger and published to realtime — the same shape as
`bookings` → `court_occupancy`. "เกมถัดไป" sends back the `called_at` the admin saw, so two
staff tapping at once cannot send the same players off twice.

### Lessons with a coach — migration 0019
A coach account (`profiles.is_coach`, granted by an admin as before) writes its own listing and
weekly hours at `/coach`, and sees its upcoming classes and what the shop still owes it.
Customers pick a coach, a length (1–3h) and a free time at `/coaches/[id]`; only times that
work are offered — inside the coach's hours and the venue's, with the coach free and a court
free. Booking takes the cheapest free court, and the bill is court price plus lesson fee.
`/admin/coaches` shows what is owed to each coach and records a pay-out for exactly the
lessons listed on screen.

A lesson's time is fixed for the customer (the coach agreed to it), so a reschedule request on
one is refused; cancelling and refunding work as usual. The shop may still move a lesson by
hand. A coach cannot be double-booked, and cannot book a court to play on over their own class.

---

## 8. Suggested next tasks (in order)

1. **Use the queue once for real** on a ก๊วน night: open it, have two or three people join from
   their phones, call a few games, then close it. Watch that a phone updates without a refresh.
2. **Set up one coach end to end**: grant coach rights, write the listing and hours, book a
   lesson, check the bill is court + fee, then cancel it. Do this late in the evening.
3. **Prove an ordinary booking still works** now that 0019 has added triggers to `bookings`:
   book one court, confirm ฿130, cancel it. Do this before the shop opens.
4. Prove the multi-time cart booking: book two courts at different times and check the database
   stores one bill with the right times and total.
5. Exercise `adminUploadSlipFile` on a confirmed booking and on an unpaid one.
6. Watch the next real customer slip and confirm the BILLERID check passes it.
7. Ask the owner to turn on branch protection for `main` (require a PR and an approval), and
   add a GitHub Action that runs `npm test` and `npm run test:db` on every PR.
8. Confirm the ฿130 price, then make `config.ts` agree or document that the database wins.
9. Expire `awaiting_review` bookings after N hours (migration, owner approval).
10. Add security headers in `next.config.mjs`; retest LINE login and image loading after.
