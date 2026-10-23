// A dry run of a ก๊วน night on a throwaway database, so the new rules can be watched
// working before any SQL is run on the shop's live project.
//
// Nothing here can reach the live database: it never reads .env, never opens a network
// connection, and the Postgres it uses lives inside this process and disappears when the
// script ends. Safe to run while customers are booking.
//
// Usage: npm run sandbox
import { createSandboxDb, actAs, MIGRATIONS } from "./lib/sandbox-db.mjs";

const HOST = "aaaaaaaa-0000-0000-0000-00000000aaaa";
const ADMIN = "bbbbbbbb-0000-0000-0000-00000000bbbb";
const PLAYERS = [
  { id: "cccccccc-0000-0000-0000-00000000c001", name: "ส้ม" },
  { id: "cccccccc-0000-0000-0000-00000000c002", name: "เบนซ์" },
  { id: "cccccccc-0000-0000-0000-00000000c003", name: "ปอนด์" },
];

const line = (s = "") => console.log(s);
const head = (s) => {
  line();
  line(`──── ${s} ────`);
};

const db = await createSandboxDb();
let problems = 0;
const expect = (label, ok) => {
  line(`   ${ok ? "ok " : "NO "} ${label}`);
  if (!ok) problems++;
};
const as = (uid) => actAs(db, uid);
const one = async (sql) => (await db.query(sql)).rows[0];
const all = async (sql) => (await db.query(sql)).rows;

async function refused(label, sql, code) {
  try {
    await db.query(sql);
    expect(`${label} — แต่ระบบปล่อยผ่าน!`, false);
  } catch (e) {
    expect(`${label} (${code})`, e.message.includes(code));
  }
}

line(`ฐานข้อมูลใช้แล้วทิ้ง: รัน migration ${MIGRATIONS.length} ไฟล์ ถึง ${MIGRATIONS.at(-1)}`);
line("ไม่ได้ต่อกับฐานข้อมูลจริงของร้าน และไม่ได้อ่านไฟล์ .env ใดๆ");

const players = PLAYERS.map((p) => `('${p.id}', '${p.name}@sandbox.test', '{"display_name":"${p.name}"}')`).join(",\n  ");
await db.exec(`insert into auth.users (id, email, raw_user_meta_data) values
  ('${ADMIN}', 'admin@sandbox.test', '{"display_name":"แอดมิน"}'),
  ('${HOST}', 'host@sandbox.test', '{"display_name":"โดม"}'),
  ${players};
  update profiles set is_admin = true where id = '${ADMIN}';`);

// ---------------------------------------------------------------------------
head("1. ใครเปิดห้องก๊วนได้ (migration 0027)");
const { party_at: partyAt } = await one(
  `select ((now() at time zone 'Asia/Bangkok')::date + 1 + time '18:00') at time zone 'Asia/Bangkok' as party_at`,
);
const startsAt = new Date(partyAt).toISOString();
const openRoom = (title) =>
  `select * from create_party_booking(4::smallint, '${startsAt}', 2, 'singles', '${title}', 'โดม')`;

await as(PLAYERS[0].id);
await refused("ลูกค้าทั่วไปเปิดห้องก๊วนไม่ได้", openRoom("ห้องมั่ว"), "PARTY_SUBSCRIPTION_REQUIRED");

await as(ADMIN);
await db.query(`select set_party_host('${HOST}', true)`);
line("   แอดมินเปิดสิทธิ์หัวห้องให้ โดม แล้ว");

await as(HOST);
const room = await one(openRoom("ก๊วนเดี่ยว คืนวันเสาร์"));
const booking = await one(`select amount, status from bookings where id = '${room.booking_id}'`);
expect(`เปิดห้องได้ บิล ฿${booking.amount} สถานะ ${booking.status}`, booking.status === "pending_payment");

// The room only becomes public once the shop confirms the payment.
await db.exec(`update bookings set status = 'confirmed' where id = '${room.booking_id}'`);
const roomRow = await one(`select status, mode, capacity from party_rooms where id = '${room.party_id}'`);
expect(`ยืนยันเงินแล้ว ห้องเปิด (${roomRow.status}, ${roomRow.mode}, รับ ${roomRow.capacity} คน)`, roomRow.status === "open");

// ---------------------------------------------------------------------------
head("2. ผู้เล่นเข้าห้อง — ห้องเดี่ยวเข้าคิวทันที ไม่ต้องรอทีมครบ");
const hostEntry = await one(`select id from party_members where party_id = '${room.party_id}' and user_id = '${HOST}'`);
// A slot belongs to a fixed team (party_team_slot_valid: slots 1-2 are A, 3-4 are B, ...).
// A singles room hides the teams, so the page works the team out from the slot the player
// tapped; join_party refuses the pair otherwise. See chooseSinglesSlot in PartyRoomCard.
const teamForSlot = (n) => "ABCDEF"[Math.floor((n - 1) / 2)];
let slot = 2;
for (const p of PLAYERS) {
  await as(p.id);
  await db.query(
    `select join_party('${room.party_id}', '${p.name}', ${slot}::smallint, '${teamForSlot(slot)}'::party_team)`,
  );
  slot += 1;
}
const queue = await all(`select name, state from party_singles_queue where party_id = '${room.party_id}' order by queued_at`);
line(`   คิวตามลำดับที่เข้าห้อง: ${queue.map((q) => q.name).join(" -> ")}`);
expect("ทุกคนอยู่ในคิวแล้ว 4 คน", queue.length === 4);
expect("หัวห้องอยู่หัวคิว", queue[0].name === "โดม");

await as(PLAYERS[0].id);
await refused("ลูกค้าในห้องสั่งเริ่มแมตช์ไม่ได้ (เฉพาะหัวห้อง)", `select advance_singles_match('${room.party_id}', null)`, "FORBIDDEN");

// ---------------------------------------------------------------------------
head("3. เล่นจริง — ชนะอยู่ต่อ แพ้ไปต่อท้ายคิว");
const board = async () => {
  const playing = await one(
    `select round_no, player_a_name, player_b_name from party_singles_match_board
     where party_id = '${room.party_id}' and status = 'playing'`,
  );
  const waiting = await all(
    `select name from party_singles_queue where party_id = '${room.party_id}' and state = 'waiting' order by queued_at`,
  );
  return { playing, waiting: waiting.map((w) => w.name) };
};

await as(HOST);
await db.query(`select advance_singles_match('${room.party_id}', null)`);
let state = await board();
line(`   รอบ ${state.playing.round_no}: ${state.playing.player_a_name} พบ ${state.playing.player_b_name}   | รอคิว: ${state.waiting.join(", ")}`);
expect("คู่แรกคือสองคนที่เข้าห้องก่อน", state.playing.player_a_name === "โดม" && state.playing.player_b_name === "ส้ม");

// The host taps the winner. Player A wins every round here, so one player holds the court
// and everyone else rotates through the line.
const beaten = [];
for (let round = 1; round <= 3; round += 1) {
  const current = await one(
    `select player_a_entry, player_a_name, player_b_name from party_singles_match_board
     where party_id = '${room.party_id}' and status = 'playing'`,
  );
  await db.query(`select advance_singles_match('${room.party_id}', '${current.player_a_entry}')`);
  beaten.push(current.player_b_name);
  state = await board();
  const next = state.playing
    ? ` -> รอบ ${state.playing.round_no}: ${state.playing.player_a_name} พบ ${state.playing.player_b_name}   | รอคิว: ${state.waiting.join(", ")}`
    : "  -> ไม่มีผู้ท้าชิงเหลือ";
  line(`   ${current.player_a_name} ชนะ ${current.player_b_name}${next}`);
}

const justLost = beaten.at(-1);
expect("ผู้ชนะยังอยู่ในสนาม", state.playing?.player_a_name === "โดม");
expect(`ผู้แพ้คนล่าสุด (${justLost}) ไปต่อท้ายคิว — รอคิว: ${state.waiting.join(" -> ")}`, state.waiting.at(-1) === justLost);
expect("ทุกคนได้ลงเล่น ไม่มีใครถูกข้าม", new Set(beaten).size === PLAYERS.length);
expect(`หมุนคิวครบวง กลับมาเจอ ${state.playing?.player_b_name} อีกครั้ง`, state.playing?.player_b_name === beaten[0]);

await refused(
  "หัวห้องเลือกคนที่ไม่ได้อยู่ในคู่นี้ไม่ได้",
  `select advance_singles_match('${room.party_id}', '${PLAYERS[2].id}')`,
  "INVALID_PARTY_WINNER",
);

// ---------------------------------------------------------------------------
head("4. ประวัติการแข่งขันที่ลูกค้าเห็นในหน้าห้อง");
for (const m of await all(
  `select round_no, player_a_name, player_b_name, winner_name, status
   from party_singles_match_board where party_id = '${room.party_id}' order by round_no`,
)) {
  const result = m.status === "playing" ? "กำลังแข่ง" : `${m.winner_name} ชนะ`;
  line(`   รอบ ${m.round_no}: ${m.player_a_name} พบ ${m.player_b_name} — ${result}`);
}

// ---------------------------------------------------------------------------
head("5. ของเดิมยังไม่พัง");
await as(PLAYERS[0].id);
const { t: courtAt } = await one(
  `select ((now() at time zone 'Asia/Bangkok')::date + 1 + time '09:00') at time zone 'Asia/Bangkok' as t`,
);
const courtStart = new Date(courtAt).toISOString();
const plain = await one(`select * from create_booking(1::smallint, '${courtStart}', 1)`);
expect(`จองสนามปกติ 1 ชม. ได้ ฿${plain.amount}`, plain.status === "pending_payment");
await refused("จองทับเวลาเดิมไม่ได้", `select create_booking(1::smallint, '${courtStart}', 1)`, "SLOT_TAKEN");

const teams = await one(`select count(*)::int n from party_team_queue where party_id = '${room.party_id}'`);
expect("คิวทีม (ของห้องคู่) ไม่ปนเข้ามาในห้องเดี่ยว", teams.n === 0);

line();
line(problems ? `พบปัญหา ${problems} จุด` : "ผ่านทั้งหมด — กฎใหม่ทำงานอย่างที่ออกแบบไว้ บนฐานข้อมูลใช้แล้วทิ้ง");
line("ฐานข้อมูลนี้หายไปพร้อมกับการจบสคริปต์ ไม่มีอะไรค้างอยู่ที่ไหน");
process.exit(problems ? 1 : 0);
