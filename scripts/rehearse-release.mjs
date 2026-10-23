// Usage: npm run rehearse
//
// A rehearsal of the real thing: bring a database up to exactly where the shop's is
// now (0001-0028), put a ก๊วน night and some bookings in it, and only then run the
// combined release script. The sandbox has only ever applied migrations to an empty
// database, so the backfills in 0029-0032 have never met rows before this.
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { readFileSync, readdirSync } from "node:fs";

const MIG = new URL("../supabase/migrations/", import.meta.url);
const RELEASE = new URL("../supabase/ops/release-0029-to-0032.sql", import.meta.url);
const SKIP = new Set(["0002_expire_holds_cron.sql"]);

const upTo28 = readdirSync(MIG)
  .filter((f) => f.endsWith(".sql") && !SKIP.has(f) && f.slice(0, 4) <= "0028")
  .sort();

const db = new PGlite({ extensions: { btree_gist } });
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
for (const f of upTo28) await db.exec(readFileSync(new URL(f, MIG), "utf8"));
console.log(`ฐานข้อมูลอยู่ที่สถานะเดียวกับร้านตอนนี้: ${upTo28.length} ไฟล์ ถึง ${upTo28.at(-1)}`);

let bad = 0;
const check = (name, ok, extra = "") => { console.log(`${ok ? "ok " : "NO "} ${name} ${extra}`); if (!ok) bad++; };
const as = (u) => db.exec(`select set_config('test.uid', '${u ?? ""}', false)`);
const one = async (sql) => (await db.query(sql)).rows[0];

// ---- ข้อมูลเดิมที่ร้านมีอยู่: ห้องก๊วนที่เล่นไปแล้ว การจองปกติ และคนที่จองค้างไว้ ----
const ADMIN = "aaaa0000-0000-0000-0000-00000000000a";
const HOST = "bbbb0000-0000-0000-0000-00000000000b";
const P = ["cccc0000-0000-0000-0000-00000000000c", "dddd0000-0000-0000-0000-00000000000d",
           "eeee0000-0000-0000-0000-00000000000e"];
await db.exec(`insert into auth.users (id, email, raw_user_meta_data) values
  ('${ADMIN}','admin@x','{"display_name":"แอดมิน"}'),
  ('${HOST}','host@x','{"display_name":"โดม"}'),
  ${P.map((p, i) => `('${p}','p${i}@x','{"display_name":"ผู้เล่น ${i + 1}"}')`).join(",")};
  update profiles set is_admin = true where id = '${ADMIN}';`);
await as(ADMIN);
await db.query(`select set_party_host('${HOST}', true)`);

const { t } = await one(`select ((now() at time zone 'Asia/Bangkok')::date + 1 + time '18:00') at time zone 'Asia/Bangkok' as t`);
await as(HOST);
const room = await one(`select * from create_party_booking(4::smallint, '${new Date(t).toISOString()}', 2, 'doubles', 'ก๊วนเดิมของร้าน', 'โดม')`);
await db.exec(`update bookings set status = 'confirmed' where id = '${room.booking_id}'`);
for (const [i, p] of P.entries()) {
  await as(p);
  await db.query(`select join_party('${room.party_id}', 'ผู้เล่น ${i + 1}', ${i + 2}::smallint, '${"ABCDEF"[Math.floor((i + 1) / 2)]}'::party_team)`);
}
// a plain court booking, the thing that must never break
await as(P[0]);
const { t2 } = await one(`select ((now() at time zone 'Asia/Bangkok')::date + 1 + time '09:00') at time zone 'Asia/Bangkok' as t2`);
const booking = await one(`select * from create_booking(1::smallint, '${new Date(t2).toISOString()}', 1)`);

const before = {
  members: (await one(`select count(*)::int n from party_members where status='active'`)).n,
  rooms: (await one(`select count(*)::int n from party_rooms`)).n,
  bookings: (await one(`select count(*)::int n from bookings`)).n,
};
console.log(`ข้อมูลเดิมก่อนรัน: ห้อง ${before.rooms} · สมาชิก ${before.members} · การจอง ${before.bookings}`);

// ---- รันไฟล์รวมจริง ----
const release = readFileSync(RELEASE, "utf8");
try {
  await db.exec(release);
  check("ไฟล์รวม 0029-0032 รันผ่านบนฐานข้อมูลที่มีข้อมูลอยู่แล้ว", true);
} catch (e) {
  check("ไฟล์รวม 0029-0032 รันผ่าน", false, `(${e.message})`);
  process.exit(1);
}

// ---- ข้อมูลเดิมต้องอยู่ครบ ----
check("ห้องก๊วนเดิมยังอยู่ครบ", (await one(`select count(*)::int n from party_rooms`)).n === before.rooms);
check("สมาชิกเดิมยังอยู่ครบ", (await one(`select count(*)::int n from party_members where status='active'`)).n === before.members);
check("การจองเดิมยังอยู่ครบ", (await one(`select count(*)::int n from bookings`)).n === before.bookings);
check("การจองสนามเดิมยังมีสถานะเดิม",
  (await one(`select status from bookings where id='${booking.id}'`)).status === "pending_payment");

// ---- backfill ต้องทำงานกับข้อมูลเดิม ----
check(`สร้างสถิติให้สมาชิกเดิมครบทุกคน (${before.members} คน)`,
  (await one(`select count(*)::int n from party_player_stats`)).n === before.members);
check("ห้องเดิมได้ค่าเริ่มต้นเป็นสาธารณะ + จัดอันดับ",
  (await one(`select visibility, scoring from party_rooms where id='${room.party_id}'`)).visibility === "public");
const board = await one(`select visibility, scoring, win_streak_cap from party_room_board where party_id='${room.party_id}'`);
check(`กระดานห้องได้คอลัมน์ใหม่ครบ (${board.visibility}/${board.scoring}/ชนะติด ${board.win_streak_cap})`,
  board.visibility === "public" && board.scoring === "ranked" && board.win_streak_cap === 3);
check("ทุกคนที่มีอยู่ได้รหัสผู้เล่นสาธารณะ",
  (await one(`select count(*)::int n from profiles where public_player_id is null`)).n === 0);

// ---- ของใหม่ใช้งานได้จริงบนข้อมูลเดิม ----
await as(HOST);
await db.query(`select advance_party_match('${room.party_id}', null)`);
const match = await one(`select team_a, team_b from party_match_board where party_id='${room.party_id}' and status='playing'`);
check(`เริ่มแข่งในห้องเดิมได้ (ทีม ${match?.team_a} พบ ทีม ${match?.team_b})`, Boolean(match));

await as(P[0]);
await db.query(`select create_community_post('ทดสอบหลังอัปเกรด')`);
check("คอมมูนิตี้ใช้งานได้", (await one(`select count(*)::int n from community_feed`)).n === 1);

// ---- การจองสนามปกติ ซึ่งห้ามพังเด็ดขาด ----
const { t3 } = await one(`select ((now() at time zone 'Asia/Bangkok')::date + 2 + time '10:00') at time zone 'Asia/Bangkok' as t3`);
const after = await one(`select * from create_booking(2::smallint, '${new Date(t3).toISOString()}', 1)`);
check(`จองสนามหลังอัปเกรดยังทำได้ ฿${after.amount}`, after.status === "pending_payment");

// ---- พิสูจน์ว่าถ้าพังกลางทาง ฐานข้อมูลคืนสภาพเดิมจริง ----
// รันไฟล์เดิมซ้ำบนฐานข้อมูลที่มีของพวกนี้อยู่แล้ว ต้องพังแน่ๆ (สร้างตารางซ้ำไม่ได้)
// แล้วเช็กว่าไม่มีอะไรค้างครึ่งๆ กลางๆ
const postsBefore = (await one(`select count(*)::int n from community_posts`)).n;
let rolledBack = false;
try {
  await db.exec(release);
} catch {
  rolledBack = true;
  // The failed BEGIN block leaves this session stuck, so clear it the way any client
  // does. In the Supabase SQL Editor each run gets its own session and it is automatic.
  await db.exec("rollback;");
}
check("รันซ้ำแล้วพังตามคาด (ของมีอยู่แล้ว)", rolledBack);
check("พังแล้วข้อมูลไม่เสียหาย โพสต์เดิมยังอยู่",
  (await one(`select count(*)::int n from community_posts`)).n === postsBefore);
check("พังแล้วห้องก๊วนเดิมยังอยู่ครบ",
  (await one(`select count(*)::int n from party_rooms`)).n === before.rooms);
const stillWorks = await one(`select count(*)::int n from party_player_stats`);
check(`พังแล้วของที่รันสำเร็จรอบแรกยังใช้ได้ (สถิติ ${stillWorks.n} แถว)`, stillWorks.n === before.members);

console.log();
console.log(bad ? `พบปัญหา ${bad} จุด` : "ผ่านทั้งหมด — รันกับฐานข้อมูลที่มีข้อมูลจริงอยู่แล้วได้ ข้อมูลเดิมไม่หาย");
process.exit(bad ? 1 : 0);
