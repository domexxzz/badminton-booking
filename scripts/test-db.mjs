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

console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);

