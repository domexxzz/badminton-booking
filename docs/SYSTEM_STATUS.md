# System status: badminton-booking (แบดมินตัน@สินธานี)

As of **2026-10-22**, `main` at `ea477c4`. This file is the current source of truth.
`PROJECT_HANDOFF.md` is older and partly out of date (it still says Vercel, ฿150, and older test counts).

Read `AGENTS.md` before changing anything. It lists which files need the owner's (โดม) approval.

---

## 1. What it is

A badminton court booking site with 4 courts. Customers book, pay through a Bangkok Bank merchant QR, and upload a slip. An admin reviews each slip and confirms the booking. Customers pay real money, so keep changes small and safe.

| | |
|---|---|
| Live site | https://badminton-booking-ihw1.onrender.com (admin: `/admin`) |
| Hosting | Render, Singapore, **Starter** plan. Configured in `render.yaml`. Every push to `main` builds and deploys automatically (about 1.5 minutes). |
| Database | Supabase project `ktecjmuyrufzkxoidrnc` (Postgres + Auth + Storage + Realtime) |
| Repo | https://github.com/domexxzz/badminton-booking |
| Old host | `badminton-booking-steel.vercel.app` is dead (returns HTTP 402). Nothing should link to it. |
| Stack | Next.js 15.5 (App Router, Server Actions), React 19, Supabase SSR, Vitest, PGlite for DB tests |

**Local dev uses the live database.** There is no staging database. Never create bookings, press admin buttons, or run SQL against it while testing.

---

## 2. Current state

### Recently shipped (live)
- **PR #16, perf:** customer pages read courts, opening hours and shop contact from a shared 60-second cache (`src/lib/public-data.ts`). Bookings and occupancy are always read live. Admin pages read the database directly.
  - Effect on the live site at 50 concurrent users: median page time went from 1.19s to 0.60s, throughput from 24.8 to 31.7 pages/s, with 0% errors.
- **PR #17 / #18, Ta's work:**
  - Emerald brand redesign of the home, schedule and admin pages. Brand images are in `public/brand/` and are served through `next/image`, about 20–45KB each on phones.
  - Refund to a typed bank account as an alternative to a refund QR, with migration `0016_refund_bank_account.sql`. This migration **is applied** on the live DB.

### Open work
1. **PR #15, `fix/slip-receiver-date-check` (not merged, needs a real slip first).**
   - **The bug:** the automatic slip check on `main` compares **only the amount**. A slip paid to someone else, or an old slip, is labelled "ตรงกับยอดที่ต้องชำระ".
   - **The fix in the PR:** re-wires `evaluateSlip` (receiver account, receiver name, transfer time) through `src/lib/slip/check-record.ts`.
   - **Blocker:** customers pay a **Bangkok Bank Merchant Pro bill-payment QR** (tag 30, biller ID `010753600037406`, merchant `1077272`), not a PromptPay phone number. Nobody has yet seen how EasySlip reports the receiver for this kind of slip.
     - If it shows a masked bank account, setting `SLIP_RECEIVER_BANK_ACCOUNT` is enough.
     - If it shows a biller ID / proxy type such as `BILLERID`, then `accountMatches` in `src/lib/slip/evaluate.ts` must learn to match the biller ID first. Otherwise every slip will be labelled "mismatch".
   - **Next step:** run `EASYSLIP_API_KEY` from `.env.local` against one real slip paid to this QR. Print only the receiver fields, then decide.
   - **Before merge:** set on Render: `EASYSLIP_API_KEY`, `SLIP_RECEIVER_NAME` (e.g. `อัครเนย์ ลาน้ำเที่ยง,akkanay`), and `SLIP_RECEIVER_BANK_ACCOUNT`. Merge right after the key is set. With the key set and #15 not merged, the weak amount-only check goes live.
   - Labels never confirm bookings by themselves. An admin always approves.
2. **Live price is ฿130/hour (฿65 per 30 min).** It comes from `courts.price_per_hour` in the DB. `src/lib/config.ts` still says 150, but that value is display and fallback only. Confirm with the owner that 130 is intended. Do not "fix" either side on your own.

### Not set up / known gaps
- **`main` has no branch protection.** Collaborators (e.g. `somwhang1815-cell`, Ta / `Fanta1049`) can push or merge straight to production.
- **Security headers:** no CSP, HSTS, X-Frame-Options or nosniff (`next.config.mjs`).
- **Rate limiting:** none on server actions or email OTP. The only limits are in the DB: 6 bookings per hour and 4 open bookings per user.
- **Stuck bookings:** an `awaiting_review` booking never expires. A junk slip holds a court until an admin acts.
- **Typhoon OCR:** if `TYPHOON_API_KEY` is set, it **replaces** EasySlip (`verify-booking.ts`). It is an AI reading of the image: easy to fool, and it has no real `transRef`. Keep it unset in production.
- **Bank webhook:** `/api/bank-notifications` needs `BANK_WEBHOOK_SECRET` (32+ chars) and `BANK_APP_PACKAGES`. Without them it returns 503. It never confirms bookings by itself.
- **`npm audit`:** reports postcss (via Next) high/moderate. It is build-time only and low risk.
- **Supabase backups:** check the plan in the dashboard (Database → Backups). This is not verified.
- **Local `npm run build` on the owner's Windows machine:** it sometimes fails with `spawn UNKNOWN` from Git Bash and from cmd, even on unchanged `main`. This is an environment issue. Run it from PowerShell, or trust the Render build log.

---

## 3. How money flows (do not break)

1. A customer picks courts and time in `/book`. `create_multi_booking` creates `pending_payment` bookings with a **5-minute hold**. Several courts share one `group_id`, which makes one bill.
2. The customer pays with the merchant QR. The QR is built in `src/lib/promptpay.ts` (constant `BBL_MERCHANT_PRO_QR`, with a dynamic amount).
3. The customer uploads a slip to the private `slips` bucket. `submit_slip` sets `awaiting_review` and clears the hold.
4. The optional auto-check (`verifyLatestSlip`) labels the payment (`verify_status`, `verify_reasons`). It **never confirms**.
5. An admin approves in `/admin/review`, which calls `review_payment` (checks `is_admin()`). Bookings become `confirmed`. LINE notifications are sent if configured.
6. A customer can cancel until **12:00 on the booking day** (or until start, if earlier) with a refund QR or a typed bank account (`request_cancel`). An admin then attaches the refund slip.

Rules are enforced **in the database**, not only in the UI:
- No double booking: a `btree_gist` exclusion constraint on court and time range. This is race-safe.
- 30-minute steps, minimum 0.5h, maximum 4h online, at most 14 days ahead.
- Opening hours come from `venue_settings`.
- Coaches (`profiles.is_coach`, granted by an admin) can pay later and enter an agreed price, never above list price.
- Every admin RPC checks `is_admin()` inside a `SECURITY DEFINER` function with `search_path = public`.
- RLS is on for every table.

---

## 4. Code map

| Area | Where |
|---|---|
| Customer pages | `src/app/(customer)/` — `/`, `/book`, `/schedule`, `/bookings/[id]`, `/me`, `/login` |
| Admin pages | `src/app/admin/` — dashboard, `review` (slips), `board`, `new` (book for a walk-in or phone customer), `requests` (cancel/reschedule), `analytics`, `settings`, `team` |
| Server actions | `src/app/actions.ts`, `request-actions.ts`, `admin-actions.ts` |
| Routes | `src/app/api/bank-notifications/`, `src/app/auth/callback` (email OTP), `src/app/auth/line/*` (LINE Login) |
| Slip check | `src/lib/slip/` — `easyslip.ts`, `evaluate.ts`, `typhoon.ts`, `verify-booking.ts` |
| Bank inbox | `src/lib/bank/` |
| LINE | `src/lib/line/` |
| Supabase clients | `src/lib/supabase/` (`service.ts` = service role, server only) |
| Cached public data | `src/lib/public-data.ts`, `src/lib/venue-rows.ts` |
| Styles | `src/app/globals.css` |
| DB schema | `supabase/migrations/0001`–`0016`. 0016 was verified on live (2026-10-22); 0012 per the old handoff; the rest are assumed applied but not verified one by one. |

**Needs owner approval before changing** (from `AGENTS.md`):
- `supabase/migrations/**`
- `src/lib/supabase/**`, `src/app/api/**`
- `actions.ts`, `request-actions.ts`, `admin-actions.ts`
- `src/middleware.ts`, `src/lib/slip/**`, `src/lib/bank/**`, `src/lib/line/**`
- Prices and hours in `config.ts`
- Any `.env*` file

---

## 5. Environment variables (names only — never print or commit values)

| Variable | Needed for | If missing |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | everything | site fails to start |
| `SUPABASE_SERVICE_ROLE_KEY` | slip check, webhook, LINE login, admin slip upload | those features are off |
| `NEXT_PUBLIC_SITE_URL` | LINE callback, email links (read at **build** time; redeploy after changing) | LINE login is off; email links point to localhost |
| `BBL_MERCHANT_PRO_QR` | payee QR shown on `/bookings/[id]` | the committed `BBL_MERCHANT_PRO_QR` in `promptpay.ts` is used. `PROMPTPAY_ID` only overrides it when it holds a full EMV payload (starts with `000201`); a plain phone number there is ignored for the QR. |
| `PROMPTPAY_ID` | PromptPay proxy for the slip receiver check (`evaluate.ts`) | receiver check falls back to `SLIP_RECEIVER_BANK_ACCOUNT` |
| `EASYSLIP_API_KEY` | automatic slip check | admin checks every slip by hand |
| `SLIP_RECEIVER_NAME`, `SLIP_RECEIVER_BANK_ACCOUNT` | receiver check (PR #15) | with #15 merged, every slip shows "mismatch" |
| `LINE_LOGIN_CHANNEL_ID`, `LINE_LOGIN_CHANNEL_SECRET` | LINE Login | LINE login button is off |
| `LINE_MESSAGING_TOKEN`, `LINE_NOTIFY_EVENTS` | LINE alerts to shop and customers | no LINE alerts |
| `BANK_WEBHOOK_SECRET`, `BANK_APP_PACKAGES` | money-in inbox from the shop phone | webhook returns 503 |
| `TYPHOON_API_KEY` | AI OCR fallback | keep **unset** in production |

- **Render:** `render.yaml` lists only some of these. Check the Render dashboard → Environment for what is actually set.
- **LINE:** the LINE Developers callback must be `https://badminton-booking-ihw1.onrender.com/auth/line/callback`.
- **Supabase Auth:** URL configuration must use the Render domain.

---

## 6. Working rules

- Branch per change: `ui/<name>` for UI, `fix/…` or `perf/…` otherwise. Open a PR with a **Thai** description (plain words; the teammate is not a developer). Include before/after screenshots for UI changes.
- Do not push to `main`, deploy, or run SQL on the live DB yourself. Merging to `main` **is** deploying.
- Mobile-first. Check at about 390px width, in light and dark mode.
- Before saying done:
  - `npm test` (151 tests on `main`)
  - `npm run test:db` (migrations and business rules in PGlite; must print `ALL PASSED`)
  - `npx tsc --noEmit`
  - `npm run build`
- To load-test, use only read-only GETs of public pages, and agree a time with the owner first. The script used before ramped 5 → 10 → 25 → 50 virtual users, 30s each, with 0.5–1.5s think time, and stopped at 5% errors or p95 > 8s.

---

## 7. Suggested next tasks (in order)

1. Read one real merchant-QR slip with EasySlip. Adjust `evaluate.ts` for the biller ID if needed. Set the env vars on Render, then merge PR #15.
2. Ask the owner to turn on branch protection for `main` (require PR + approval).
3. Confirm the ฿130 price with the owner. Then make `config.ts` match or document that the DB is authoritative.
4. Expire `awaiting_review` bookings after N hours with no admin action. This needs a migration and owner approval.
5. Add security headers in `next.config.mjs`. Test LINE login and image loading after.
6. Rate-limit OTP and booking actions (Supabase Auth settings plus middleware).
