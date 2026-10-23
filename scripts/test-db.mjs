// Runs the migrations in PGlite (in-process Postgres) with stub auth/storage
// schemas and checks the booking rules end to end. 0002 (pg_cron) is skipped.
// Usage: npm run test:db
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { readFileSync } from "node:fs";

const MIGRATIONS = [
  "0001_init.sql",
  "0003_slip_verification.sql",
  "0004_bank_notifications.sql",
  "0005_admin_bookings.sql",
  "0006_line.sql",
  "0007_round_amounts.sql",
  "0008_half_hour_and_rules.sql",
  "0009_booking_requests.sql",
  "0010_manage_admins.sql",
  "0011_venue_settings.sql",
  "0012_multi_court_bookings.sql",
  "0013_self_cancel_deadline.sql",
  "0014_coach_terms.sql",
  "0015_shop_contact.sql",
  "0016_refund_bank_account.sql",
  "0017_multi_slot_bookings.sql",
  "0018_play_queue.sql",
  "0019_coach_lessons.sql",
  "0020_party_queue.sql",
  "0021_party_join_flow.sql",
  "0022_party_six_teams.sql",
  "0023_party_slot_null_check.sql",
  "0024_profile_avatar.sql",
  "0025_party_winner_stays.sql",
  "0026_sync_party_member_avatars.sql",
];
const db = new PGlite({ extensions: { btree_gist } });

// Minimal stand-ins for what Supabase provides.
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth; create schema storage;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}', raw_app_meta_data jsonb default '{}');
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql as $$ select string_to_array(name, '/') $$;
  create publication supabase_realtime;
`);
for (const file of MIGRATIONS) {
  await db.exec(readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8"));
}

const U1 = "11111111-1111-1111-1111-111111111111";
const U2 = "22222222-2222-2222-2222-222222222222";
const ADMIN = "33333333-3333-3333-3333-333333333333";
await db.exec(`insert into auth.users (id, email) values ('${U1}','a@x.com'),('${U2}','b@x.com'),('${ADMIN}','admin@x.com');
  update profiles set is_admin = true where id = '${ADMIN}';`);

const as = (uid) => db.exec(`select set_config('test.uid', '${uid}', false)`);
let failures = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "PASS" : "FAIL"} ${name} ${extra}`); if (!ok) failures++; };
async function expectError(name, sql, code) {
  try { await db.query(sql); check(name, false, "(no error)"); }
  catch (e) { check(name, e.message.includes(code), `(${e.message})`); }
}

// Tomorrow 17:00 Bangkok (closing is 23:00, so at(5) = 22:00 is the last 1-hour slot)
const { rows: [{ t }] } = await db.query(`select ((now() at time zone 'Asia/Bangkok')::date + 1 + time '17:00') at time zone 'Asia/Bangkok' as t`);
const start = new Date(t).toISOString();
const at = (h) => new Date(Date.parse(start) + h * 3600e3).toISOString();

await as(U1);
const { rows: [b1] } = await db.query(`select * from create_booking(1::smallint, '${start}', 2)`);
const amt1 = Number(b1.amount);
check("create booking at the plain court price", b1.status === "pending_payment" && amt1 === 300, JSON.stringify({ amount: b1.amount }));
const occ = await db.query(`select state from court_occupancy where booking_id = '${b1.id}'`);
check("occupancy mirrors hold", occ.rows[0]?.state === "held");

await as(U2);
await expectError("overlap on same court blocked", `select create_booking(1::smallint, '${at(1)}', 1)`, "SLOT_TAKEN");
const { rows: [b2] } = await db.query(`select * from create_booking(2::smallint, '${at(1)}', 1)`);
check("same time other court ok", b2.status === "pending_payment");
const { rows: [b3] } = await db.query(`select * from create_booking(1::smallint, '${at(2)}', 1)`);
check("adjacent slot ok", b3.status === "pending_payment");
check("open bookings can share a price", Number(b2.amount) === 150 && Number(b3.amount) === 150, `${b2.amount} vs ${b3.amount}`);
await db.query(`select create_booking(3::smallint, '${at(0)}', 1)`);
const { rows: [b4hold] } = await db.query(`select * from create_booking(4::smallint, '${at(0)}', 1)`);
check("can hold 4 courts concurrently", b4hold.status === "pending_payment");
await expectError("open booking limit at 4", `select create_booking(1::smallint, '${at(4)}', 1)`, "TOO_MANY_HOLDS");
await db.query(`select cancel_booking('${b4hold.id}')`);
await expectError("outside hours", `select create_booking(4::smallint, '${at(5)}', 2)`, "OUTSIDE_OPENING_HOURS");
await expectError("invalid start minute", `select create_booking(4::smallint, '${at(0.25)}', 1)`, "INVALID_START");
await expectError("invalid duration step", `select create_booking(4::smallint, '${at(0.5)}', 0.25)`, "INVALID_DURATION");
await as(U1);
const { rows: [halfHourBk] } = await db.query(`select * from create_booking(4::smallint, '${at(0.5)}', 0.5)`);
check("half-hour booking starts at :30 and costs 75 THB", halfHourBk.status === "pending_payment" && Number(halfHourBk.amount) === 75);
await db.query(`select cancel_booking('${halfHourBk.id}')`);
await as(U2);
await expectError("past start", `select create_booking(4::smallint, date_trunc('hour', now()) - interval '1 day', 1)`, "START_IN_PAST");

// Expiry frees the slot
await db.exec(`update bookings set hold_expires_at = now() - interval '1 minute' where id = '${b3.id}'`);
const { rows: [{ n }] } = await db.query(`select expire_holds() as n`);
check("expire_holds", n === 1);
const gone = await db.query(`select 1 from court_occupancy where booking_id = '${b3.id}'`);
check("expired removed from occupancy", gone.rows.length === 0);

// Slip flow
await as(U1);
await expectError("slip must exist", `select submit_slip('${b1.id}', '${U1}/${b1.id}-1.jpg')`, "INVALID_SLIP");
await db.exec(`insert into storage.objects (bucket_id, name) values ('slips', '${U2}/${b1.id}-1.jpg'), ('slips', '${U1}/${b1.id}-1.jpg')`);
await expectError("slip path must be own folder", `select submit_slip('${b1.id}', '${U2}/${b1.id}-1.jpg')`, "INVALID_SLIP");
await as(U2);
await expectError("cannot submit for others", `select submit_slip('${b1.id}', '${U1}/${b1.id}-1.jpg')`, "BOOKING_NOT_FOUND");
await as(U1);
const { rows: [s] } = await db.query(`select * from submit_slip('${b1.id}', '${U1}/${b1.id}-1.jpg')`);
check("slip submitted", s.status === "awaiting_review" && s.hold_expires_at === null);
await expectError("customer cannot review", `select review_payment('${b1.id}', true)`, "FORBIDDEN");
await expectError("customer cannot cancel paid", `select cancel_booking('${b1.id}')`, "INVALID_STATUS");

await as(ADMIN);
const { rows: [r] } = await db.query(`select * from review_payment('${b1.id}', false, 'ยอดไม่ตรง')`);
check("reject returns to pending with new hold", r.status === "pending_payment" && r.hold_expires_at !== null && r.review_note === "ยอดไม่ตรง");
await as(U1);
await db.exec(`insert into storage.objects (bucket_id, name) values ('slips', '${U1}/${b1.id}-2.png')`);
await db.query(`select submit_slip('${b1.id}', '${U1}/${b1.id}-2.png')`);
await as(ADMIN);
const { rows: [c] } = await db.query(`select * from review_payment('${b1.id}', true)`);
check("approve confirms", c.status === "confirmed");
const booked = await db.query(`select state, hold_expires_at from court_occupancy where booking_id = '${b1.id}'`);
check("occupancy shows booked", booked.rows[0]?.state === "booked");
const pays = await db.query(`select status from payments where booking_id = '${b1.id}' order by created_at`);
check("payment history", pays.rows.map((p) => p.status).join(",") === "rejected,approved", pays.rows.map((p) => p.status).join(","));

// Late slip: hold lapsed but not yet expired is still accepted; once expired it is not
await as(U1);
const { rows: [late] } = await db.query(`select * from create_booking(3::smallint, '${at(3)}', 1)`);
await db.exec(`update bookings set hold_expires_at = now() - interval '30 seconds' where id = '${late.id}';
  insert into storage.objects (bucket_id, name) values ('slips', '${U1}/${late.id}-1.jpg')`);
const { rows: [ls] } = await db.query(`select * from submit_slip('${late.id}', '${U1}/${late.id}-1.jpg')`);
check("late slip accepted before expiry", ls.status === "awaiting_review");
const { rows: [gone2] } = await db.query(`select * from create_booking(3::smallint, '${at(4)}', 1)`);
await db.exec(`update bookings set hold_expires_at = now() - interval '1 minute' where id = '${gone2.id}'; select expire_holds();
  insert into storage.objects (bucket_id, name) values ('slips', '${U1}/${gone2.id}-1.jpg')`);
await expectError("slip rejected after expiry", `select submit_slip('${gone2.id}', '${U1}/${gone2.id}-1.jpg')`, "HOLD_EXPIRED");

// Cancel frees slot
await as(U2);
const { rows: [x] } = await db.query(`select * from cancel_booking('${b2.id}')`);
check("customer cancels own hold", x.status === "cancelled");
const { rows: [b4] } = await db.query(`select * from create_booking(2::smallint, '${at(1)}', 1)`);
check("cancelled slot rebookable", b4.status === "pending_payment");

// Privilege: users cannot self-promote
const priv = await db.query(`select has_column_privilege('authenticated', 'public.profiles', 'is_admin', 'UPDATE') as p`);
check("is_admin not updatable by users", priv.rows[0].p === false);

// ---- Automatic slip verification (0003) ----
const RSC = "public.record_slip_check(uuid,text,text[],text,numeric,timestamptz,jsonb)";
const rscPriv = await db.query(
  `select has_function_privilege('authenticated', '${RSC}', 'EXECUTE') as user_can,
          has_function_privilege('service_role', '${RSC}', 'EXECUTE') as service_can`,
);
check("only service_role can record slip checks", rscPriv.rows[0].user_can === false && rscPriv.rows[0].service_can === true);

const submittedPayment = async (bookingId) =>
  (await db.query(`select id from payments where booking_id = '${bookingId}' and status = 'submitted'`)).rows[0].id;
const record = async (paymentId, status, transRef, amount) =>
  (await db.query(`select record_slip_check($1, $2, $3, $4, $5, now(), '{}'::jsonb) as r`,
    [paymentId, status, ["reason"], transRef, amount])).rows[0].r;
const bookingRow = async (id) => (await db.query(`select * from bookings where id = '${id}'`)).rows[0];
async function submitFresh(uid, bookingId, n) {
  await as(uid);
  await db.exec(`insert into storage.objects (bucket_id, name) values ('slips', '${uid}/${bookingId}-${n}.jpg')`);
  await db.query(`select submit_slip('${bookingId}', '${uid}/${bookingId}-${n}.jpg')`);
  return submittedPayment(bookingId);
}

// `late` (U1) is awaiting review from the scenario above.
const latePay = await submittedPayment(late.id);
check("verified slip auto-confirms", (await record(latePay, "verified", "TX1", late.amount)) === "verified");
check("booking confirmed by auto-check", (await bookingRow(late.id)).status === "confirmed");

// U2 tries to reuse TX1 for another booking: flagged, left for the admin.
const reusePay = await submitFresh(U2, b4.id, 1);
check("reused slip detected", (await record(reusePay, "verified", "TX1", b4.amount)) === "duplicate");
check("reused slip waits for admin", (await bookingRow(b4.id)).status === "awaiting_review");
const reuseRow = (await db.query(`select status, trans_ref from payments where id = '${reusePay}'`)).rows[0];
check("reused payment does not claim the ref", reuseRow.status === "submitted" && reuseRow.trans_ref === null);

// A slip "verified" for a different amount is downgraded by the database.
await as(ADMIN);
await db.query(`select review_payment('${b4.id}', false, 'x')`);
const wrongPay = await submitFresh(U2, b4.id, 2);
check("db refuses to confirm a wrong amount", (await record(wrongPay, "verified", "TX2", Number(b4.amount) - 1)) === "mismatch");
check("mismatch waits for admin", (await bookingRow(b4.id)).status === "awaiting_review");

// Unreadable or failed checks never act on their own.
check("unreadable waits for admin", (await record(wrongPay, "unreadable", null, null)) === "unreadable"
  && (await bookingRow(b4.id)).status === "awaiting_review");

// Once an admin decides, a late auto-check must not override it.
await as(ADMIN);
await db.query(`select review_payment('${b4.id}', true)`);
check("auto-check never overrides admin", (await record(wrongPay, "error", null, null)) === "skipped");
check("admin decision kept", (await bookingRow(b4.id)).status === "confirmed");

// After 3 rejected slips the customer has to talk to an admin.
await as(U2);
const { rows: [b5] } = await db.query(`select * from create_booking(4::smallint, '${at(2)}', 1)`);
for (let n = 1; n <= 3; n++) {
  await submitFresh(U2, b5.id, n);
  await as(ADMIN);
  await db.query(`select review_payment('${b5.id}', false, 'blurry')`);
}
await as(U2);
await db.exec(`insert into storage.objects (bucket_id, name) values ('slips', '${U2}/${b5.id}-4.jpg')`);
await expectError("slip attempts are capped", `select submit_slip('${b5.id}', '${U2}/${b5.id}-4.jpg')`, "TOO_MANY_SLIP_ATTEMPTS");

// Bookings with a slip under review count toward the per-user limit.
// (Pretend U2's earlier bookings were made hours ago, so the hourly cap doesn't apply.)
await db.exec(`update bookings set created_at = created_at - interval '2 hours' where user_id = '${U2}'`);
const { rows: [b6] } = await db.query(`select * from create_booking(2::smallint, '${at(3)}', 1)`);
await submitFresh(U2, b6.id, 1);
await as(U2);
const openNow = (await db.query(`select count(*)::int as n from bookings where user_id = '${U2}' and status in ('pending_payment','awaiting_review')`)).rows[0].n;
check("setup: U2 has 3 open bookings, one under review", openNow === 3, `open=${openNow}`);
const { rows: [b7] } = await db.query(`select * from create_booking(2::smallint, '${at(4)}', 1)`);
check("U2 can book 4th open booking", b7.status === "pending_payment");
await expectError("slips under review count toward the limit (5th fails)", `select create_booking(2::smallint, '${at(5)}', 1)`, "TOO_MANY_HOLDS");

// ---- Incoming-transfer notifications (0004) ----
const RBN = "public.record_bank_notification(text,text,text,text,text,numeric,timestamptz,text)";
const rbnPriv = await db.query(
  `select has_function_privilege('authenticated', '${RBN}', 'EXECUTE') as user_can,
          has_function_privilege('service_role', '${RBN}', 'EXECUTE') as service_can`,
);
check("only service_role can record bank notifications", rbnPriv.rows[0].user_can === false && rbnPriv.rows[0].service_can === true);

let keySeq = 0;
const notify = async (direction, amount, { key = `k${++keySeq}`, postedAt = null, reviewReason = null } = {}) => ({
  ...(await db.query(`select record_bank_notification($1, 'com.bank.app', 'title', 'body', $2, $3, $4, $5) as r`,
    [key, direction, amount, postedAt, reviewReason])).rows[0].r,
  key,
});
// Look rows up by key: back-to-back inserts can share a timestamp on coarse clocks.
const noteFor = async ({ key }) => (await db.query(`select * from bank_notifications where dedupe_key = $1`, [key])).rows[0];

// Every booking costs the plain price, so money in never confirms anything by itself.
await as(U1);
const { rows: [bn1] } = await db.query(`select * from create_booking(1::smallint, '${at(3)}', 2)`);
const m1 = await notify("in", bn1.amount, { key: "same-event" });
const m1Row = await noteFor(m1);
check("a transfer never confirms a booking on amount alone", m1.outcome === "unmatched" && (await bookingRow(bn1.id)).status === "pending_payment");
check("the inbox points at the only open booking with that price", m1Row.booking_id === bn1.id && m1Row.note.includes("1 รายการ"), m1Row.note);
check("same notification twice is a duplicate", (await notify("in", bn1.amount, { key: "same-event" })).outcome === "duplicate");
check("outgoing transfers are ignored", (await notify("out", 500.25)).outcome === "ignored");
check("money in with an unreadable amount goes to the admin inbox", (await notify("in", null)).outcome === "unmatched");
const stray = await notify("in", 777.77);
check("money with no booking is unmatched", stray.outcome === "unmatched" && (await noteFor(stray)).note.includes("ไม่มีการจอง"));

// Several open ฿150 bookings: the admin gets the count, not a guess.
const many = await notify("in", 150);
const manyRow = await noteFor(many);
check("a price shared by several open bookings is not pinned to one", manyRow.booking_id === null && /[2-9] รายการ/.test(manyRow.note), manyRow.note);

// Late transfer for an expired booking never brings it back.
const { rows: [bn2] } = await db.query(`select * from create_booking(1::smallint, '${at(2)}', 1)`);
await db.exec(`update bookings set hold_expires_at = now() - interval '1 minute' where id = '${bn2.id}'; select expire_holds();`);
const late2 = await notify("in", bn2.amount);
const late2Row = await noteFor(late2);
check("late transfer for an expired booking goes to admin", late2.outcome === "unmatched" && (await bookingRow(bn2.id)).status === "expired");

// Money stamped before a booking existed is not pinned to it.
const early = await notify("in", bn1.amount, { postedAt: new Date(Date.now() - 3600e3).toISOString() });
check("a transfer from before the booking is not pinned to it", early.outcome === "unmatched" && (await noteFor(early)).booking_id === null);

// A suspicious notification carries the server's reason.
// (Pretend U1's earlier bookings were made hours ago, so the hourly cap doesn't apply.)
await db.exec(`update bookings set created_at = created_at - interval '2 hours' where user_id = '${U1}'`);
const { rows: [bn4] } = await db.query(`select * from create_booking(3::smallint, '${at(5)}', 1)`);
const flagged = await notify("in", bn4.amount, { reviewReason: "เวลาในแจ้งเตือนผิดปกติ" });
check("flagged notification waits for admin", (await noteFor(flagged)).note === "เวลาในแจ้งเตือนผิดปกติ" && (await bookingRow(bn4.id)).status === "pending_payment");

// Admin inbox handling.
await expectError("customers cannot mark notifications handled", `select mark_bank_notification_handled('${late2Row.id}')`, "FORBIDDEN");
await as(ADMIN);
await db.query(`select mark_bank_notification_handled('${late2Row.id}')`);
check("admin marks notification handled", (await db.query(`select handled_at from bank_notifications where id = '${late2Row.id}'`)).rows[0].handled_at !== null);
check("heartbeat recorded", (await db.query(`select last_seen_at from bank_listener_status`)).rows[0].last_seen_at !== null);

// Create/cancel churn is rate limited per user.
await as(ADMIN);
for (let i = 0; i < 6; i++) {
  const { rows: [churn] } = await db.query(`select * from create_booking(4::smallint, '${at(4)}', 1)`);
  await db.query(`select cancel_booking('${churn.id}')`);
}
await expectError("bookings per hour are capped", `select create_booking(4::smallint, '${at(4)}', 1)`, "TOO_MANY_RECENT_BOOKINGS");

// ---- Phone / LINE / walk-in bookings (0005) ----
const day2 = (h) => at(24 + h); // the day after tomorrow, 17:00 + h
await as(U1);
await expectError("customers cannot create admin bookings",
  `select admin_create_booking(1::smallint, '${day2(0)}', 2, 'phone', 'คุณเอ')`, "FORBIDDEN");
await as(ADMIN);
const { rows: [phoneBk] } = await db.query(
  `select * from admin_create_booking(1::smallint, '${day2(0)}', 2, 'phone', '  คุณเอ  ', '0812345678', 'จ่ายหน้าร้าน')`);
check("phone booking is confirmed at once at the base price",
  phoneBk.status === "confirmed" && Number(phoneBk.amount) === 300 && phoneBk.channel === "phone" && phoneBk.customer_name === "คุณเอ");
const { rows: [adminHalf] } = await db.query(
  `select * from admin_create_booking(1::smallint, '${day2(2.5)}', 0.5, 'walk_in', 'คุณบี')`);
check("admin 30-min booking is 75 THB",
  adminHalf.status === "confirmed" && Number(adminHalf.amount) === 75);
const phoneOcc = (await db.query(`select state from court_occupancy where booking_id = '${phoneBk.id}'`)).rows[0];
check("phone booking blocks the live board", phoneOcc?.state === "booked");
await expectError("admin bookings need a customer name",
  `select admin_create_booking(2::smallint, '${day2(0)}', 1, 'line', '   ')`, "NAME_REQUIRED");
await expectError("admin bookings need a known channel",
  `select admin_create_booking(2::smallint, '${day2(0)}', 1, 'online', 'คุณบี')`, "INVALID_CHANNEL");
await expectError("admin bookings respect opening hours",
  `select admin_create_booking(2::smallint, '${day2(5)}', 2, 'line', 'คุณบี')`, "OUTSIDE_OPENING_HOURS");
await expectError("admin bookings cannot overlap", 
  `select admin_create_booking(1::smallint, '${day2(1)}', 1, 'walk_in', 'คุณซี')`, "SLOT_TAKEN");
await db.exec(`update bookings set created_at = created_at - interval '2 hours' where user_id = '${U1}'`);
await as(U1);
await expectError("online customers cannot book over a phone booking",
  `select create_booking(1::smallint, '${day2(1)}', 1)`, "SLOT_TAKEN");
await as(ADMIN);
const { rows: [lineBk] } = await db.query(
  `select * from admin_create_booking(2::smallint, '${day2(0)}', 1, 'line', 'คุณดี')`);
const phonePaid = await notify("in", lineBk.amount);
check("a transfer matching a phone booking's base price goes to the inbox",
  phonePaid.outcome === "unmatched" && (await noteFor(phonePaid)).booking_id === null);
const cancelledPhone = (await db.query(`select * from cancel_booking('${phoneBk.id}')`)).rows[0];
check("admin can cancel a phone booking", cancelledPhone.status === "cancelled");

// ---- LINE Login (0006) ----
const linePriv = await db.query(`select has_column_privilege('authenticated', 'public.profiles', 'line_user_id', 'UPDATE') as p`);
check("users cannot set their own LINE id", linePriv.rows[0].p === false);
await expectError("LINE ids must look like LINE user ids",
  `update profiles set line_user_id = 'not-a-line-id' where id = '${U1}'`, "check constraint");
const LINE_ID = `U${"ab".repeat(16)}`;
await db.exec(`update profiles set line_user_id = '${LINE_ID}' where id = '${U1}'`);
await expectError("nobody can register a LINE placeholder email themselves",
  `insert into auth.users (id, email) values (gen_random_uuid(), 'line-x@line-login.invalid')`, "LINE_EMAIL_RESERVED");
await expectError("nor move an existing account onto it",
  `update auth.users set email = 'line-y@LINE-login.invalid' where id = '${U2}'`, "LINE_EMAIL_RESERVED");
await db.exec(`insert into auth.users (id, email, raw_app_meta_data)
  values (gen_random_uuid(), 'line-z@line-login.invalid', '{"line_user_id": "${LINE_ID}"}')`);
check("server-created LINE accounts are allowed", true);
await db.exec(`begin;
  insert into auth.users (id, email) values ('44444444-4444-4444-4444-444444444444', 'line-w@line-login.invalid');
  update auth.users set raw_app_meta_data = '{"line_user_id": "U${"cd".repeat(16)}"}' where id = '44444444-4444-4444-4444-444444444444';
  commit;`);
check("app_metadata written later in the same transaction is accepted", true);
await expectError("one LINE account maps to one profile",
  `update profiles set line_user_id = '${LINE_ID}' where id = '${U2}'`, "duplicate key");

// ---- Reschedule / cancel requests (0009) ----
const U5 = "55555555-5555-5555-5555-555555555555";
const U6 = "66666666-6666-6666-6666-666666666666";
await db.exec(`insert into auth.users (id, email) values ('${U5}','e@x.com'),('${U6}','f@x.com')`);
const day3 = (h) => at(48 + h); // two days after tomorrow's 17:00 base
async function paidBooking(uid, court, start, hours) {
  await as(uid);
  const { rows: [bk] } = await db.query(`select * from create_booking(${court}::smallint, '${start}', ${hours})`);
  await db.exec(`insert into storage.objects (bucket_id, name) values ('slips', '${uid}/${bk.id}-1.jpg')`);
  await db.query(`select submit_slip('${bk.id}', '${uid}/${bk.id}-1.jpg')`);
  await as(ADMIN);
  await db.query(`select review_payment('${bk.id}', true)`);
  return bk;
}
const rb = await paidBooking(U5, 1, day3(0), 1);
const other = await paidBooking(U6, 2, day3(0), 1);

await as(U5);
await expectError("cannot move onto a taken slot",
  `select request_reschedule('${rb.id}', 2::smallint, '${day3(0.5)}')`, "SLOT_TAKEN");
await expectError("new start must be on a half hour",
  `select request_reschedule('${rb.id}', 1::smallint, '${day3(0.25)}')`, "INVALID_START");
const { rows: [rq] } = await db.query(`select * from request_reschedule('${rb.id}', 1::smallint, '${day3(0.5)}')`);
check("reschedule request may overlap the booking's own slot", rq.status === "pending" && rq.kind === "reschedule");
await expectError("one open request per booking",
  `select request_reschedule('${rb.id}', 3::smallint, '${day3(2)}')`, "REQUEST_PENDING");
await as(U6);
await expectError("others cannot ask to move my booking",
  `select request_reschedule('${rb.id}', 3::smallint, '${day3(2)}')`, "BOOKING_NOT_FOUND");
await expectError("customers cannot resolve requests", `select resolve_request('${rq.id}', true)`, "FORBIDDEN");
await as(ADMIN);
await db.query(`select resolve_request('${rq.id}', true)`);
const moved = await bookingRow(rb.id);
check("approved reschedule moves the booking", Date.parse(moved.starts_at) === Date.parse(day3(0.5)) && moved.status === "confirmed");
const movedOcc = (await db.query(`select starts_at from court_occupancy where booking_id = '${rb.id}'`)).rows[0];
check("the live board follows the move", Date.parse(movedOcc.starts_at) === Date.parse(day3(0.5)));

// Approval re-checks the slot: someone else may have taken it meanwhile.
await as(U5);
const { rows: [rq2] } = await db.query(`select * from request_reschedule('${rb.id}', 3::smallint, '${day3(2)}')`);
await paidBooking(U6, 3, day3(2), 1);
await expectError("approving onto a slot taken since the request fails",
  `select resolve_request('${rq2.id}', true)`, "SLOT_TAKEN");
await db.query(`select resolve_request('${rq2.id}', false, 'สนามเต็มแล้ว')`);
check("admin can reject with a note",
  (await db.query(`select status, admin_note from booking_requests where id = '${rq2.id}'`)).rows[0].admin_note === "สนามเต็มแล้ว");

// Cancel with refund.
await as(U5);
await expectError("cancel needs the customer's QR on file",
  `select request_cancel('${rb.id}', '${U5}/${rb.id}-qr-1.png')`, "INVALID_QR");
await db.exec(`insert into storage.objects (bucket_id, name) values ('refunds', '${U5}/${rb.id}-qr-1.png')`);
const { rows: [cq] } = await db.query(`select * from request_cancel('${rb.id}', '${U5}/${rb.id}-qr-1.png', 'ติดธุระ')`);
check("cancel request recorded", cq.kind === "cancel" && cq.reason === "ติดธุระ");
await as(ADMIN);
await expectError("refund needs the slip", `select resolve_request('${cq.id}', true)`, "REFUND_SLIP_REQUIRED");
await db.exec(`insert into storage.objects (bucket_id, name) values ('refunds', '${U5}/${rb.id}-refund-1.jpg')`);
await db.query(`select resolve_request('${cq.id}', true, 'โอนคืนแล้ว', '${U5}/${rb.id}-refund-1.jpg')`);
check("approved cancel frees the court", (await bookingRow(rb.id)).status === "cancelled"
  && (await db.query(`select 1 from court_occupancy where booking_id = '${rb.id}'`)).rows.length === 0);
check("refund slip is kept for the customer",
  (await db.query(`select refund_slip_path from booking_requests where id = '${cq.id}'`)).rows[0].refund_slip_path === `${U5}/${rb.id}-refund-1.jpg`);
await as(U5);
await expectError("cancelled bookings cannot be changed again",
  `select request_reschedule('${rb.id}', 1::smallint, '${day3(3)}')`, "INVALID_STATUS");

// Withdraw.
await as(U6);
const { rows: [wq] } = await db.query(`select * from request_reschedule('${other.id}', 4::smallint, '${day3(1)}')`);
await db.query(`select withdraw_request('${wq.id}')`);
check("customer can withdraw a pending request",
  (await db.query(`select status from booking_requests where id = '${wq.id}'`)).rows[0].status === "withdrawn");

// ---- Managing admins (0010) ----
await as(U1);
await expectError("customers cannot grant admin", `select set_admin('${U1}', true)`, "FORBIDDEN");
await as(ADMIN);
await db.query(`select set_admin('${U5}', true)`);
check("admin can grant admin", (await db.query(`select is_admin from profiles where id = '${U5}'`)).rows[0].is_admin === true);
await expectError("admins cannot remove themselves", `select set_admin('${ADMIN}', false)`, "CANNOT_REMOVE_SELF");
await db.query(`select set_admin('${U5}', false)`);
check("admin can remove another admin", (await db.query(`select is_admin from profiles where id = '${U5}'`)).rows[0].is_admin === false);
await expectError("unknown users are rejected", `select set_admin(gen_random_uuid(), true)`, "USER_NOT_FOUND");


// ---- Venue settings (0011) ----
await as(U1);
await expectError("customers cannot update venue hours", "select update_venue_hours(8, 23)", "FORBIDDEN");
await as(ADMIN);
await expectError("invalid hours: open >= close", "select update_venue_hours(23, 23)", "INVALID_HOURS");
await expectError("invalid hours: close beyond 24", "select update_venue_hours(9, 25)", "INVALID_HOURS");
await db.query("select update_venue_hours(8.0, 24.0)");
const venueRow = (await db.query("select open_hour, close_hour from venue_settings where id = 1")).rows[0];
check("admin can update venue hours to 8:00 - 24:00", Number(venueRow.open_hour) === 8 && Number(venueRow.close_hour) === 24);
await db.query("select update_venue_hours(9.0, 23.0)");

// ---- Multi-court booking in single bill (0012) ----
const U7 = "77777777-7777-7777-7777-777777777777";
await db.exec(`insert into auth.users (id, email) values ('${U7}','u7@x.com')`);
await as(U7);
const day4 = (h) => at(72 + h);

// Reject duplicate court IDs
await expectError("cannot specify duplicate court ids in multi-court booking",
  `select create_multi_booking(array[1::smallint, 1::smallint], '${day4(0)}', 1.0)`, "INVALID_COURTS");

// Book Court 2 and Court 3 together for 1 hour at day4(0)
const { rows: [mbLead] } = await db.query(
  `select * from create_multi_booking(array[2::smallint, 3::smallint], '${day4(0)}', 1.0)`
);
check("multi-court booking returns lead row", mbLead && mbLead.court_id === 2);

const { rows: groupRows } = await db.query(
  `select * from bookings where group_id = '${mbLead.group_id}' order by court_id`
);
check("creates 2 booking rows sharing the same group_id",
  groupRows.length === 2 && groupRows[0].court_id === 2 && groupRows[1].court_id === 3);

// Both courts must be held in court_occupancy
const { rows: occRows } = await db.query(
  `select * from court_occupancy where booking_id in ('${groupRows[0].id}', '${groupRows[1].id}')`
);
check("occupancy mirrors both held courts", occRows.length === 2 && occRows.every(r => r.state === "held"));

// Submit slip for the combined amount (150 + 150 = 300)
await db.exec(`insert into storage.objects (bucket_id, name) values ('slips', '${U7}/${mbLead.id}-1.jpg')`);
await db.query(`select submit_slip('${mbLead.id}', '${U7}/${mbLead.id}-1.jpg')`);

const { rows: afterSlipRows } = await db.query(
  `select status from bookings where group_id = '${mbLead.group_id}'`
);
check("submitting slip updates all bookings in group to awaiting_review",
  afterSlipRows.length === 2 && afterSlipRows.every(r => r.status === "awaiting_review"));

const { rows: [payRow] } = await db.query(
  `select * from payments where booking_id = '${mbLead.id}'`
);
check("payment record captures the total group amount (300)", Number(payRow.amount) === 300);

// Auto-check with matching total amount (300) confirms BOTH bookings in the group
await db.query(`select record_slip_check('${payRow.id}', 'verified', '{}'::text[], 'TRX-MULTI-1', 300.0)`);
const { rows: afterVerifyRows } = await db.query(
  `select status from bookings where group_id = '${mbLead.group_id}'`
);
check("verified slip confirms all bookings in the group",
  afterVerifyRows.length === 2 && afterVerifyRows.every(r => r.status === "confirmed"));

// Single-court booking through create_booking still works and has a group_id
const { rows: [singleB] } = await db.query(
  `select * from create_booking(4::smallint, '${day4(0)}', 1.0)`
);
check("single-court create_booking generates a group_id",
  singleB && singleB.group_id !== null && singleB.court_id === 4);

// ---- Self-cancel deadline (0013) ----
const deadline = async (start) =>
  new Date((await db.query(`select self_cancel_deadline($1::timestamptz) as d`, [start])).rows[0].d).toISOString();
check("evening booking: cancel until 12:00 that day",
  (await deadline("2026-10-20T18:00:00+07:00")) === new Date("2026-10-20T12:00:00+07:00").toISOString());
check("morning booking: cancel until it starts",
  (await deadline("2026-10-20T09:30:00+07:00")) === new Date("2026-10-20T09:30:00+07:00").toISOString());
check("cancelled booking waits for the refund",
  (await db.query(`select status, refund_amount from booking_requests where id = '${cq.id}'`)).rows[0].status === "approved"
  && Number(cq.refund_amount) === Number(rb.amount) && cq.status === "refund_pending");
await as(ADMIN);
await expectError("a refund cannot be rejected once the booking is cancelled",
  `select resolve_request('${cq.id}', false)`, "REQUEST_NOT_FOUND");

// Cancelling one court of a multi-court bill cancels the whole bill.
const U9 = "99999999-9999-9999-9999-999999999999";
await db.exec(`insert into auth.users (id, email) values ('${U9}','i@x.com')`);
const pairA = await paidBooking(U9, 1, day3(4), 1);
const pairB = await paidBooking(U9, 2, day3(4), 1);
await db.exec(`update bookings set group_id = '${pairA.id}' where id in ('${pairA.id}', '${pairB.id}')`);
await as(U9);
await db.exec(`insert into storage.objects (bucket_id, name) values ('refunds', '${U9}/${pairA.id}-qr-1.png')`);
const { rows: [gq] } = await db.query(`select * from request_cancel('${pairA.id}', '${U9}/${pairA.id}-qr-1.png')`);
check("whole bill is cancelled and refunded together",
  (await bookingRow(pairB.id)).status === "cancelled" && Number(gq.refund_amount) === Number(pairA.amount) + Number(pairB.amount));

// ---- Coach terms (0014) ----
const COACH = "88888888-8888-8888-8888-000000000001";
await db.exec(`insert into auth.users (id, email) values ('${COACH}','coach@x.com')`);
const coachDay = (h) => at(96 + h);
await as(COACH);
await expectError("only coaches get special terms",
  `select create_coach_booking(array[1,2]::smallint[], '${coachDay(0)}', 2, true, 500)`, "NOT_COACH");
const coachPriv = await db.query(`select has_column_privilege('authenticated', 'public.profiles', 'is_coach', 'UPDATE') as p`);
check("customers cannot make themselves coaches", coachPriv.rows[0].p === false);
await as(U1);
await expectError("customers cannot grant coach rights", `select set_coach('${COACH}', true)`, "FORBIDDEN");
await as(ADMIN);
await db.query(`select set_coach('${COACH}', true)`);

await as(COACH);
await expectError("agreed price cannot exceed list price",
  `select create_coach_booking(array[1,2]::smallint[], '${coachDay(0)}', 2, true, 9999)`, "INVALID_AMOUNT");
const { rows: [cb] } = await db.query(`select * from create_coach_booking(array[1,2]::smallint[], '${coachDay(0)}', 2, true, 501)`);
const coachRows = (await db.query(`select amount, list_amount, status, pay_later, paid_at from bookings where group_id = '${cb.group_id}' order by court_id`)).rows;
check("pay-later bill is confirmed straight away", coachRows.every((r) => r.status === "confirmed" && r.pay_later && r.paid_at === null));
check("agreed total is spread over the courts", coachRows.reduce((s, r) => s + Number(r.amount), 0) === 501
  && coachRows.every((r) => Number(r.list_amount) > 0));
check("pay-later courts show as booked", (await db.query(`select state from court_occupancy where booking_id = '${cb.id}'`)).rows[0]?.state === "booked");
await expectError("an unpaid bill has nothing to refund",
  `select request_cancel('${cb.id}', '${COACH}/${cb.id}-qr-1.png')`, "NO_REFUND_NEEDED");

await expectError("coaches cannot mark their own bill paid", `select mark_booking_paid('${cb.id}')`, "FORBIDDEN");
await as(ADMIN);
await db.query(`select mark_booking_paid('${cb.id}')`);
check("admin marks the whole bill paid",
  (await db.query(`select bool_and(paid_at is not null) as ok from bookings where group_id = '${cb.group_id}'`)).rows[0].ok === true);

await as(COACH);
const { rows: [nowPay] } = await db.query(`select * from create_coach_booking(array[3]::smallint[], '${coachDay(0)}', 1, false, 100)`);
check("pay-now coach booking waits for payment at the agreed price",
  nowPay.status === "pending_payment" && Number(nowPay.amount) === 100 && Number(nowPay.list_amount) === 150);
const { rows: [later2] } = await db.query(`select * from create_coach_booking(array[4]::smallint[], '${coachDay(0)}', 1, true, null)`);
await db.query(`select cancel_booking('${later2.id}')`);
check("coach cancels an unpaid pay-later booking without a refund", (await bookingRow(later2.id)).status === "cancelled");

// ---- Shop contact (0015) ----
await as(U1);
await expectError("customers cannot change the shop contact",
  `select update_shop_contact('x', '0812345678', 'abc')`, "FORBIDDEN");
await as(ADMIN);
await expectError("phone must be a Thai number", `select update_shop_contact('Akkanay', '12345', null)`, "INVALID_PHONE");
await expectError("LINE must be an ID or a LINE link",
  `select update_shop_contact('Akkanay', null, 'https://evil.example/x')`, "INVALID_LINE");
await db.query(`select update_shop_contact(' Akkanay ', '082-945-7278', '@sinthani')`);
const contact = (await db.query(`select contact_name, contact_phone, contact_line from venue_settings where id = 1`)).rows[0];
check("admin saves the shop contact (phone digits only)",
  contact.contact_name === "Akkanay" && contact.contact_phone === "0829457278" && contact.contact_line === "@sinthani");

// ---- Optional QR or bank account for refunds (0016) ----
const refundUser = "abababab-abab-abab-abab-abababababab";
await db.exec(`insert into auth.users (id, email) values ('${refundUser}', 'refund-test@example.invalid')`);
const accountBooking = await paidBooking(refundUser, 1, at(24 * 7), 1);
await as(refundUser);
await expectError("refund rejects neither QR nor account",
  `select request_cancel('${accountBooking.id}', null, null, null)`, "REFUND_DETAILS_REQUIRED");
await expectError("refund rejects whitespace account",
  `select request_cancel('${accountBooking.id}', null, null, '   ')`, "REFUND_DETAILS_REQUIRED");
await expectError("refund rejects tabs and line breaks without an account",
  `select request_cancel('${accountBooking.id}', null, null, chr(9) || chr(10))`, "REFUND_DETAILS_REQUIRED");
await expectError("refund rejects oversized account",
  `select request_cancel('${accountBooking.id}', null, null, repeat('1', 301))`, "INVALID_REFUND_ACCOUNT");
check("invalid refund details keep the booking confirmed", (await bookingRow(accountBooking.id)).status === "confirmed");
await as(U1);
await expectError("account refund cannot cancel someone else's booking",
  `select request_cancel('${accountBooking.id}', null, null, 'Test Bank 0000000000 Test Customer')`, "BOOKING_NOT_FOUND");
await as(refundUser);
const { rows: [accountRequest] } = await db.query(
  `select * from request_cancel($1, null, 'Account only', $2)`,
  [accountBooking.id, '  Test Bank\n0000000000\nTest Customer  ']);
check("account-only refund preserves account and has no QR", accountRequest.refund_qr_path === null
  && accountRequest.refund_account === 'Test Bank\n0000000000\nTest Customer'
  && accountRequest.status === 'refund_pending' && Number(accountRequest.refund_amount) === Number(accountBooking.amount));
check("account-only cancellation frees the court", (await bookingRow(accountBooking.id)).status === 'cancelled'
  && (await db.query(`select 1 from court_occupancy where booking_id = '${accountBooking.id}'`)).rows.length === 0);
await expectError("cancelled account request cannot be submitted twice",
  `select request_cancel('${accountBooking.id}', null, null, '0000000000')`, "INVALID_STATUS");
await as(ADMIN);
await expectError("account refund still requires admin refund slip",
  `select resolve_request('${accountRequest.id}', true)`, "REFUND_SLIP_REQUIRED");
await expectError("pending account refund cannot be rejected",
  `select resolve_request('${accountRequest.id}', false)`, "INVALID_STATUS");
await db.exec(`insert into storage.objects (bucket_id, name) values ('refunds', '${refundUser}/${accountBooking.id}-refund-1.jpg')`);
await db.query(`select resolve_request('${accountRequest.id}', true, null, '${refundUser}/${accountBooking.id}-refund-1.jpg')`);
check("admin can finish account refund with audit and slip",
  (await db.query(`select * from booking_requests where id = '${accountRequest.id}'`)).rows[0].resolved_by === ADMIN);

const bothBooking = await paidBooking(refundUser, 2, at(24 * 7), 1);
await as(refundUser);
await expectError("invalid attached QR cannot bypass validation with an account",
  `select request_cancel('${bothBooking.id}', 'invalid.png', null, '0000000000')`, "INVALID_QR");
await db.exec(`insert into storage.objects (bucket_id, name) values ('refunds', '${refundUser}/${bothBooking.id}-qr-1.png')`);
const { rows: [bothRequest] } = await db.query(`select * from request_cancel('${bothBooking.id}', '${refundUser}/${bothBooking.id}-qr-1.png', null, '0000000000')`);
check("refund accepts QR and account together", Boolean(bothRequest.refund_qr_path) && bothRequest.refund_account === '0000000000');
check("anonymous users cannot call account refund RPC",
  !(await db.query(`select has_function_privilege('anon', 'public.request_cancel(uuid,text,text,text)', 'execute') as allowed`)).rows[0].allowed);

// ---- Play queue (0018) ----
const boardFor = async (court) =>
  (await db.query(`select name, status from queue_board where court_id = ${court} order by queued_at`)).rows;
const entryRow = async (id) => (await db.query(`select * from queue_entries where id = '${id}'`)).rows[0];
// What an admin looking at the court would send back with "next game".
const seenCalledAt = async (court) =>
  (await db.query(
    `select max(called_at) as t from queue_entries where court_id = ${court} and status = 'playing'`)).rows[0].t;
const nextGame = async (court) =>
  (await db.query(`select queue_next_game($1::smallint, $2) as n`, [court, await seenCalledAt(court)])).rows[0].n;

await as(U1);
await expectError("cannot join a closed queue", `select join_queue(1::smallint, 'เอ')`, "QUEUE_CLOSED");
await expectError("customers cannot open a queue", `select set_court_queue(1::smallint, true, 4::smallint)`, "FORBIDDEN");
await as(ADMIN);
await expectError("players per game is 2 to 4", `select set_court_queue(1::smallint, true, 5::smallint)`, "INVALID_PLAYERS_PER_GAME");
await db.query(`select set_court_queue(1::smallint, true, 2::smallint)`);
await db.query(`select set_court_queue(2::smallint, true, 4::smallint)`);

await as(U1);
await expectError("a nickname is required", `select join_queue(1::smallint, '   ')`, "INVALID_NAME");
const { rows: [qe1] } = await db.query(`select * from join_queue(1::smallint, '  เอ   ตัวจริง  ')`);
check("join tidies the nickname and waits", qe1.status === "waiting" && qe1.name === "เอ ตัวจริง" && qe1.user_id === U1);
await expectError("one place per person across courts", `select join_queue(2::smallint, 'เอ')`, "ALREADY_IN_QUEUE");
await as(U2);
const { rows: [qe2] } = await db.query(`select * from join_queue(1::smallint, 'บี')`);
await as(ADMIN);
const { rows: [qe3] } = await db.query(`select * from admin_add_to_queue(1::smallint, 'ซี walk-in')`);
check("admin adds a walk-in without an account", qe3.user_id === null && qe3.created_by === ADMIN);

await as(U1);
await expectError("customers cannot call the next game", `select queue_next_game(1::smallint, null)`, "FORBIDDEN");
await expectError("customers cannot move others", `select queue_entry_action('${qe2.id}', 'remove')`, "FORBIDDEN");
const boardCols = (await db.query(
  `select string_agg(column_name, ',' order by column_name) as c from information_schema.columns
   where table_schema = 'public' and table_name = 'queue_board'`)).rows[0].c;
check("the public board carries no user id", !boardCols.includes("user"), boardCols);
check("board shows the line in order", (await boardFor(1)).map((r) => r.name).join("|") === "เอ ตัวจริง|บี|ซี walk-in");

await as(ADMIN);
const called = await nextGame(1);
check("next game calls players_per_game from the front", called === 2
  && (await entryRow(qe1.id)).status === "playing" && (await entryRow(qe2.id)).status === "playing"
  && (await entryRow(qe3.id)).status === "waiting");
// A second tap for the same game must not send the players who just went on off again.
const staleSeen = await seenCalledAt(1);
await expectError("a second next-game tap for the same game is refused",
  `select queue_next_game(1::smallint, null)`, "QUEUE_CHANGED");
await db.query(`select queue_entry_action('${qe1.id}', 'back')`);
check("send to back puts a player behind the line", (await entryRow(qe1.id)).status === "waiting"
  && (await boardFor(1)).filter((r) => r.status === "waiting").map((r) => r.name).join("|") === "ซี walk-in|เอ ตัวจริง");
await expectError("next game from a stale screen is refused",
  `select queue_next_game(1::smallint, '${new Date(Date.parse(staleSeen) - 60000).toISOString()}')`, "QUEUE_CHANGED");
await nextGame(1);
check("next game finishes the players on court", (await entryRow(qe2.id)).status === "done"
  && (await entryRow(qe3.id)).status === "playing" && (await entryRow(qe1.id)).status === "playing");
check("finished players leave the public board", !(await boardFor(1)).some((r) => r.name === "บี"));
await expectError("cannot play someone already playing", `select queue_entry_action('${qe1.id}', 'play')`, "INVALID_QUEUE_ACTION");

await as(U2);
const { rows: [qe2b] } = await db.query(`select * from join_queue(1::smallint, 'บี')`);
check("a finished player can join again", qe2b.status === "waiting");
await db.query(`select leave_queue('${qe2b.id}')`);
check("a player can leave", (await entryRow(qe2b.id)).status === "left");
await as(U1);
await expectError("cannot leave someone else's place", `select leave_queue('${qe3.id}')`, "QUEUE_ENTRY_NOT_FOUND");

// A place left over from yesterday ends by itself.
await as(U2);
const { rows: [stale] } = await db.query(`select * from join_queue(2::smallint, 'บี')`);
await db.exec(`update queue_entries set queued_at = now() - interval '2 days' where id = '${stale.id}'`);
await as(U5);
await db.query(`select join_queue(2::smallint, 'อี')`);
check("yesterday's places end on the next use", (await entryRow(stale.id)).status === "left");

await as(ADMIN);
await db.query(`select set_court_queue(1::smallint, false, 2::smallint)`);
check("closing a queue ends every place in it", (await boardFor(1)).length === 0
  && (await entryRow(qe1.id)).status === "done");
check("anonymous users cannot join", !(await db.query(
  `select has_function_privilege('anon', 'public.join_queue(smallint,text)', 'execute') as p`)).rows[0].p);

// ---- Lessons with a coach (0019) ----
const COACH2 = "88888888-8888-8888-8888-000000000002";
const STUDENT = "88888888-8888-8888-8888-000000000003";
await db.exec(`insert into auth.users (id, email) values ('${COACH2}','coach2@x.com'),('${STUDENT}','student@x.com')`);
const lessonRow = async (id) => (await db.query(`select * from bookings where id = '${id}'`)).rows[0];
// A weekday far enough ahead to stay inside the 14-day window, at 19:00 Bangkok.
const { rows: [{ d, dow }] } = await db.query(
  `select ((now() at time zone 'Asia/Bangkok')::date + 3) as d,
          extract(dow from (now() at time zone 'Asia/Bangkok')::date + 3)::int as dow`);
const lessonDay = new Date(d).toISOString().slice(0, 10);
const lessonAt = (h) => `${lessonDay}T${String(h).padStart(2, "0")}:00:00+07:00`;

await as(COACH2);
await expectError("someone who is not a coach yet cannot list themselves",
  `select save_coach_profile('${COACH2}', 'โค้ชบี', null, 300, true)`, "NOT_COACH");
await as(ADMIN);
await db.query(`select set_coach('${COACH2}', true)`);
await as(U1);
await expectError("nobody can edit someone else's coach profile",
  `select save_coach_profile('${COACH2}', 'โค้ชปลอม', null, 1, true)`, "FORBIDDEN");
await as(COACH2);
await expectError("lesson price has a ceiling",
  `select save_coach_profile('${COACH2}', 'โค้ชบี', null, 99999, true)`, "INVALID_LESSON_PRICE");
await expectError("a coach profile needs a name",
  `select save_coach_profile('${COACH2}', '   ', null, 300, true)`, "INVALID_NAME");
const { rows: [cp] } = await db.query(`select * from save_coach_profile('${COACH2}', '  โค้ช   บี ', 'สอนพื้นฐาน', 300, true)`);
check("coach saves their own profile", cp.display_name === "โค้ช บี" && cp.lesson_price_per_hour === 300 && cp.is_listed);

await expectError("hours must be whole half hours inside a day",
  `select set_coach_availability('${COACH2}', '[{"weekday":1,"start_minute":610,"end_minute":1200}]'::jsonb)`, "INVALID_AVAILABILITY");
const slots = JSON.stringify([{ weekday: dow, start_minute: 17 * 60, end_minute: 21 * 60 }]);
check("coach sets weekly hours",
  (await db.query(`select set_coach_availability('${COACH2}', '${slots}'::jsonb) as n`)).rows[0].n === 1);
check("saving hours again replaces the old ones",
  (await db.query(`select set_coach_availability('${COACH2}', '${slots}'::jsonb) as n`)).rows[0].n === 1
  && (await db.query(`select count(*)::int as n from coach_availability where coach_id = '${COACH2}'`)).rows[0].n === 1);

await as(STUDENT);
const openStarts = (await db.query(`select coach_open_starts('${COACH2}', '${lessonDay}'::date, 1.0) as s`)).rows.map((r) => r.s);
check("open lesson times stay inside the coach's hours and the venue's",
  openStarts.length > 0 && openStarts.every((s) => {
    const h = Number(new Date(s).toLocaleString("en-GB", { timeZone: "Asia/Bangkok", hour: "2-digit", hourCycle: "h23" }));
    return h >= 17 && h <= 20;
  }), `${openStarts.length} starts`);
await expectError("a lesson of 4 hours is too long",
  `select create_lesson_booking('${COACH2}', '${lessonAt(19)}', 4.0)`, "INVALID_DURATION");
await expectError("a lesson outside the coach's hours is refused",
  `select create_lesson_booking('${COACH2}', '${lessonAt(10)}', 1.0)`, "COACH_UNAVAILABLE");
await expectError("a bill that differs from the price shown is refused",
  `select create_lesson_booking('${COACH2}', '${lessonAt(19)}', 1.0, 999)`, "PRICE_CHANGED");
check("a refused price books nothing",
  (await db.query(`select count(*)::int as n from bookings where coach_id = '${COACH2}'`)).rows[0].n === 0);
const { rows: [lesson] } = await db.query(`select * from create_lesson_booking('${COACH2}', '${lessonAt(19)}', 1.0, 450)`);
check("the bill is court price plus lesson fee, waiting for payment",
  lesson.status === "pending_payment" && Number(lesson.lesson_fee) === 300
  && Number(lesson.amount) === 150 + 300 && lesson.coach_id === COACH2, JSON.stringify({ amount: lesson.amount }));
check("a lesson holds a real court on the live board",
  (await db.query(`select state from court_occupancy where booking_id = '${lesson.id}'`)).rows[0]?.state === "held");
await expectError("the same coach cannot be booked twice at once",
  `select create_lesson_booking('${COACH2}', '${lessonAt(19)}', 1.0, 450)`, "COACH_BUSY");
check("that time is gone from the open list",
  !(await db.query(`select coach_open_starts('${COACH2}', '${lessonDay}'::date, 1.0) as s`)).rows
    .some((r) => Date.parse(r.s) === Date.parse(lessonAt(19))));
await as(COACH2);
await expectError("a coach cannot book a lesson with themself",
  `select create_lesson_booking('${COACH2}', '${lessonAt(20)}', 1.0, 450)`, "CANNOT_BOOK_SELF");
// A coach cannot book a court to play on while they are teaching.
await expectError("a coach cannot book a court over their own lesson",
  `select create_booking(2::smallint, '${lessonAt(19)}', 1)`, "COACH_HAS_LESSON");
// And a court the coach booked to play on makes them busy for new lessons.
const coachOwn = await paidBooking(COACH2, 1, lessonAt(20), 1);
await as(STUDENT);
await expectError("a coach playing their own booking is busy",
  `select create_lesson_booking('${COACH2}', '${lessonAt(20)}', 1.0, 450)`, "COACH_BUSY");
// A walk-in the admin entered belongs to the admin's account, so an admin who also
// coaches is not busy because of it.
await as(ADMIN);
await db.query(`select admin_create_booking(3::smallint, '${lessonAt(21)}', 1, 'walk_in', 'คุณวอล์กอิน')`);
await as(STUDENT);
check("an admin-entered walk-in does not block that admin's own teaching",
  (await db.query(`select coach_busy('${ADMIN}', '${lessonAt(21)}', '${lessonAt(22)}') as busy`)).rows[0].busy === false);

// Paying for a lesson is an ordinary slip, and the lesson time cannot be moved.
await as(STUDENT);
await db.exec(`insert into storage.objects (bucket_id, name) values ('slips', '${STUDENT}/${lesson.id}-1.jpg')`);
await db.query(`select submit_slip('${lesson.id}', '${STUDENT}/${lesson.id}-1.jpg')`);
const lessonPay = (await db.query(`select amount from payments where booking_id = '${lesson.id}'`)).rows[0];
check("the slip is for the whole bill including the lesson fee", Number(lessonPay.amount) === 450);
await as(ADMIN);
await db.query(`select review_payment('${lesson.id}', true)`);
check("an approved lesson is confirmed", (await lessonRow(lesson.id)).status === "confirmed");
await as(STUDENT);
await expectError("a lesson cannot be moved to another time",
  `select request_reschedule('${lesson.id}', 2::smallint, '${lessonAt(18)}')`, "LESSON_FIXED_TIME");

// The coach sees their lessons with the student's name; nobody else's.
await as(COACH2);
const myLessons = (await db.query(`select * from coach_lessons()`)).rows;
check("coach sees their own lesson with the student's name",
  myLessons.length === 1 && myLessons[0].booking_id === lesson.id && myLessons[0].student_phone !== undefined);
await as(U1);
check("another user's coach_lessons() is empty", (await db.query(`select * from coach_lessons()`)).rows.length === 0);

// The shop pays the coach only for lessons already played, and only the ones it listed.
await as(COACH2);
await expectError("a coach cannot mark themselves paid",
  `select mark_coach_paid('${COACH2}', array['${lesson.id}']::uuid[])`, "FORBIDDEN");
check("only an admin sees what the shop owes a coach",
  (await db.query(`select count(*)::int as n from coach_unpaid_lessons('${COACH2}')`)).rows[0].n === 0);
await as(ADMIN);
check("a lesson in the future is not owed yet",
  (await db.query(`select count(*)::int as n from coach_unpaid_lessons('${COACH2}')`)).rows[0].n === 0);
const futurePay = (await db.query(
  `select * from mark_coach_paid('${COACH2}', array['${lesson.id}']::uuid[])`)).rows[0];
check("paying for a lesson that has not happened stamps nothing", futurePay.paid_count === 0
  && (await lessonRow(lesson.id)).coach_paid_at === null);
await db.exec(`update bookings set starts_at = starts_at - interval '30 days', ends_at = ends_at - interval '30 days'
  where id = '${lesson.id}'`);
const owedNow = (await db.query(`select * from coach_unpaid_lessons('${COACH2}')`)).rows;
check("a finished lesson shows as owed with its fee",
  owedNow.length === 1 && owedNow[0].booking_id === lesson.id && Number(owedNow[0].lesson_fee) === 300);
const paid = (await db.query(
  `select * from mark_coach_paid('${COACH2}', array['${lesson.id}']::uuid[])`)).rows[0];
check("the shop records paying the coach, with the total",
  paid.paid_count === 1 && Number(paid.paid_total) === 300 && (await lessonRow(lesson.id)).coach_paid_at !== null);
check("a lesson already paid is not owed again",
  (await db.query(`select count(*)::int as n from coach_unpaid_lessons('${COACH2}')`)).rows[0].n === 0);
await expectError("paying needs at least one lesson",
  `select * from mark_coach_paid('${COACH2}', null)`, "NOTHING_TO_PAY");

// Taking coach rights away also takes the coach off the public list.
await db.query(`select set_coach('${COACH2}', false)`);
check("an unlisted coach disappears from the public list",
  (await db.query(`select is_listed from coach_profiles where user_id = '${COACH2}'`)).rows[0].is_listed === false);
await as(STUDENT);
await expectError("an unlisted coach cannot be booked",
  `select create_lesson_booking('${COACH2}', '${lessonAt(22)}', 1.0, 450)`, "COACH_NOT_FOUND");
check("anonymous users cannot book a lesson", !(await db.query(
  `select has_function_privilege('anon', 'public.create_lesson_booking(uuid,timestamptz,numeric,numeric)', 'execute') as p`)).rows[0].p);
check("anonymous users can read the open lesson times", (await db.query(
  `select has_function_privilege('anon', 'public.coach_open_starts(uuid,date,numeric)', 'execute') as p`)).rows[0].p === true);
check("setup: the coach's own booking is untouched", (await lessonRow(coachOwn.id)).status === "confirmed");

// ---- Booking-backed Party queue (0020) ----
const PARTY_HOST = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PARTY_GUEST = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const PARTY_GUEST2 = "cccccccc-cccc-cccc-cccc-cccccccccccc";
await db.exec(`insert into auth.users (id, email, raw_user_meta_data) values
  ('${PARTY_HOST}', 'party-host@x.com', '{"display_name":"หัวห้อง"}'),
  ('${PARTY_GUEST}', 'party-guest@x.com', '{"display_name":"แขกหนึ่ง"}'),
  ('${PARTY_GUEST2}', 'party-guest2@x.com', '{"display_name":"แขกสอง"}')`);
const { rows: [{ party_at: partyAt }] } = await db.query(`select ((now() at time zone 'Asia/Bangkok')::date + 10 + time '18:00') at time zone 'Asia/Bangkok' as party_at`);
await as(PARTY_HOST);
const party = (await db.query(`select * from create_party_booking(4::smallint, '${new Date(partyAt).toISOString()}', 1, 'doubles', ' ก๊วน วันศุกร์ ', ' หัวห้อง ')`)).rows[0];
check("creating a Party also creates a pending paid booking", Boolean(party.party_id && party.booking_id) &&
  (await db.query(`select status from bookings where id='${party.booking_id}'`)).rows[0].status === "pending_payment");
check("a Party stays private until payment is confirmed",
  (await db.query(`select count(*)::int n from party_room_board where party_id='${party.party_id}'`)).rows[0].n === 0);
check("the host starts in slot 1",
  (await db.query(`select slot_no from party_members where party_id='${party.party_id}' and user_id='${PARTY_HOST}'`)).rows[0].slot_no === 1);
await db.exec(`insert into storage.objects (bucket_id, name) values ('slips', '${PARTY_HOST}/${party.booking_id}-1.jpg')`);
await db.query(`select submit_slip('${party.booking_id}', '${PARTY_HOST}/${party.booking_id}-1.jpg')`);
await as(ADMIN);
await db.query(`select review_payment('${party.booking_id}', true)`);
check("approved payment opens the Party publicly",
  (await db.query(`select count(*)::int n from party_room_board where party_id='${party.party_id}'`)).rows[0].n === 1);
await as(PARTY_GUEST);
const partyGuest = (await db.query(`select * from join_party('${party.party_id}', ' แขกหนึ่ง ', 3::smallint, 'B'::party_team)`)).rows[0];
check("a guest joins a chosen slot for free", partyGuest.slot_no === 3 &&
  (await db.query(`select count(*)::int n from party_member_board where party_id='${party.party_id}'`)).rows[0].n === 2);
await expectError("a team can only use its two assigned slots", `select join_party('${party.party_id}', 'แขกสอง', 5::smallint, 'A'::party_team)`, "INVALID_PARTY_DETAILS");
await as(PARTY_GUEST2);
await expectError("two guests cannot take the same slot", `select join_party('${party.party_id}', 'แขกสอง', 3::smallint, 'B'::party_team)`, "PARTY_SLOT_TAKEN");
await as(PARTY_GUEST);
await db.query(`select move_party_slot('${partyGuest.id}', 4::smallint, 'B'::party_team)`);
check("a guest can move their own slot", (await db.query(`select slot_no from party_member_board where entry_id='${partyGuest.id}'`)).rows[0].slot_no === 4);
// A null slot used to slip past the guard: every comparison against it is null, so the
// OR was never true, and the update failed on the NOT NULL column with a raw 23502.
await expectError("moving to a null slot is refused, not left to the column",
  `select move_party_slot('${partyGuest.id}', null, 'B'::party_team)`, "INVALID_PARTY_DETAILS");
check("the refused move left the slot alone",
  (await db.query(`select slot_no from party_member_board where entry_id='${partyGuest.id}'`)).rows[0].slot_no === 4);
await as(PARTY_GUEST2);
await expectError("a guest cannot move another member", `select move_party_slot('${partyGuest.id}', 5::smallint, 'A'::party_team)`, "PARTY_MEMBER_NOT_FOUND");
await as(PARTY_HOST);
await db.query(`select kick_party_member('${party.party_id}', '${partyGuest.id}')`);
check("the host can remove a guest", (await db.query(`select count(*)::int n from party_member_board where entry_id='${partyGuest.id}'`)).rows[0].n === 0);
await expectError("the host cannot leave their own paid room", `select leave_party((select id from party_members where party_id='${party.party_id}' and user_id='${PARTY_HOST}'))`, "PARTY_MEMBER_NOT_FOUND");
check("anonymous users cannot create or join a Party", !(await db.query(
  `select has_function_privilege('anon', 'public.create_party_booking(smallint,timestamptz,numeric,party_mode,text,text)', 'execute') as p`)).rows[0].p);

// 0024 profile avatar
await as(U1);
await db.query(`update profiles set avatar_url = 'https://profile.line-scdn.net/abc' where id = '${U1}'`);
check("a user can save their avatar_url", (await db.query(`select avatar_url from profiles where id='${U1}'`)).rows[0].avatar_url === "https://profile.line-scdn.net/abc");
const joined = (await db.query(`select * from join_party('${party.party_id}', 'ผู้เล่นหนึ่ง', 5::smallint, 'C'::party_team)`)).rows[0];
check("party_member_board includes user avatar", (await db.query(`select avatar_url from party_member_board where entry_id='${joined.id}'`)).rows[0]?.avatar_url === "https://profile.line-scdn.net/abc");

// 0026 profile avatar update propagates to party_member_board
await db.query(`update profiles set avatar_url = 'https://profile.google.com/new' where id = '${U1}'`);
check("updating profile avatar immediately updates party_member_board",
  (await db.query(`select avatar_url from party_member_board where entry_id='${joined.id}'`)).rows[0]?.avatar_url === "https://profile.google.com/new");

// ---- Party Winner Stays On Matching (0025) ----
const P_GUEST1 = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const P_GUEST2 = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const P_GUEST3 = "ffffffff-ffff-ffff-ffff-ffffffffffff";
const P_GUEST4 = "11111111-2222-3333-4444-555555555555";
const P_GUEST5 = "22222222-3333-4444-5555-666666666666";
await db.exec(`insert into auth.users (id, email, raw_user_meta_data) values
  ('${P_GUEST1}', 'pg1@x.com', '{"display_name":"ผู้เล่น 1"}'),
  ('${P_GUEST2}', 'pg2@x.com', '{"display_name":"ผู้เล่น 2"}'),
  ('${P_GUEST3}', 'pg3@x.com', '{"display_name":"ผู้เล่น 3"}'),
  ('${P_GUEST4}', 'pg4@x.com', '{"display_name":"ผู้เล่น 4"}'),
  ('${P_GUEST5}', 'pg5@x.com', '{"display_name":"ผู้เล่น 5"}')`);

// Party host is in slot 1 (Team A). Add P_GUEST1 to slot 2 (Team A) -> Team A complete!
await as(P_GUEST1);
await db.query(`select join_party('${party.party_id}', 'ผู้เล่น 1', 2::smallint, 'A'::party_team)`);
check("team A is complete and enters queue",
  (await db.query(`select count(*)::int n from party_team_queue where party_id='${party.party_id}' and team='A'`)).rows[0].n === 1);

// Add P_GUEST2 and P_GUEST3 to slots 3 and 4 (Team B) -> Team B complete!
await as(P_GUEST2);
await db.query(`select join_party('${party.party_id}', 'ผู้เล่น 2', 3::smallint, 'B'::party_team)`);
await as(P_GUEST3);
await db.query(`select join_party('${party.party_id}', 'ผู้เล่น 3', 4::smallint, 'B'::party_team)`);
check("team B is complete and enters queue",
  (await db.query(`select count(*)::int n from party_team_queue where party_id='${party.party_id}' and team='B'`)).rows[0].n === 1);

// Add P_GUEST4 and P_GUEST5 to slots 5 and 6 (Team C) -> Team C complete!
await as(P_GUEST4);
await db.query(`select join_party('${party.party_id}', 'ผู้เล่น 4', 5::smallint, 'C'::party_team)`);
await as(P_GUEST5);
await db.query(`select join_party('${party.party_id}', 'ผู้เล่น 5', 6::smallint, 'C'::party_team)`);
check("team C is complete and enters queue",
  (await db.query(`select count(*)::int n from party_team_queue where party_id='${party.party_id}' and team='C'`)).rows[0].n === 1);

// Guest cannot advance match
await as(P_GUEST1);
await expectError("guest cannot advance match", `select advance_party_match('${party.party_id}', null)`, "FORBIDDEN");

// Host starts round 1: Team A vs Team B
await as(PARTY_HOST);
await db.query(`select advance_party_match('${party.party_id}', null)`);
const r1 = (await db.query(`select * from party_match_board where party_id='${party.party_id}' and status='playing'`)).rows[0];
check("round 1 is started with team A vs team B", r1.round_no === 1 && r1.team_a === "A" && r1.team_b === "B");

// Host selects winner: Team A wins
// Winner (Team A) stays, loser (Team B) goes to back of queue, next waiting team (Team C) enters as challenger!
await db.query(`select advance_party_match('${party.party_id}', 'A'::party_team)`);
const r2 = (await db.query(`select * from party_match_board where party_id='${party.party_id}' and status='playing'`)).rows[0];
check("round 2 is team A (winner) vs team C (challenger)", r2.round_no === 2 && r2.team_a === "A" && r2.team_b === "C");

// Check queue order: Team B should now be waiting in queue behind Team C
const queueWaiting = (await db.query(`select team from party_team_queue where party_id='${party.party_id}' and state='waiting' order by queued_at`)).rows;
check("loser (team B) goes to the back of the queue", queueWaiting.length === 1 && queueWaiting[0].team === "B");

console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);

