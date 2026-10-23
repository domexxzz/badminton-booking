// A dry run of a ก๊วน night on a throwaway database, so the new rules can be watched
// working before any SQL is run on the shop's live project.
//
// Nothing here can reach the live database: it never reads .env, never opens a network
// connection, and the Postgres it uses lives inside this process and disappears when the
// script ends. Safe to run while customers are booking.
//
// Usage: npm run sandbox
import { createSandboxDb, actAs, MIGRATIONS } from "./lib/sandbox-db.mjs";
import { ELO_GRID } from "./lib/elo-grid.mjs";

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

// โดม won three in a row, which is the room's cap, so the court changes hands even
// though nobody beat him: he goes to the back and a fresh pair starts (migration 0029).
const streakCap = (await one(`select win_streak_cap from party_rooms where id = '${room.party_id}'`)).win_streak_cap;
const domeStats = await one(
  `select wins, streak, best_streak, rating from party_player_stats
   where party_id = '${room.party_id}' and entry_id = '${hostEntry.id}'`,
);
line(`   โดมชนะครบ ${streakCap} เกมติด จึงต้องลงไปพัก แม้ไม่มีใครเอาชนะได้`);
expect(`ชนะครบ ${streakCap} เกมแล้วต้องพัก ผู้ครองสนามเปลี่ยนมือ`, state.playing?.player_a_name !== "โดม");
expect(`โดมกลับไปต่อคิว — รอคิว: ${state.waiting.join(" -> ")}`, state.waiting.includes("โดม"));
expect("ทุกคนได้ลงเล่น ไม่มีใครถูกข้าม", new Set(beaten).size === PLAYERS.length);
expect(`สถิติถูกบันทึก: ชนะ ${domeStats.wins} เกม ชนะติดสูงสุด ${domeStats.best_streak} แต้ม ${domeStats.rating}`,
  domeStats.wins === 3 && domeStats.best_streak === streakCap && domeStats.rating > 1000);

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

// ---------------------------------------------------------------------------
head("6. คืนก๊วนเต็มรูปแบบ 8 คน 24 เกม — ระบบจับคู่ทำงานจริงแค่ไหน");

// Eight players of genuinely different standard. "ฝีมือจริง" is only used to decide who
// wins each simulated game; the matchmaker never sees it. It has to work the ratings out.
const NIGHT = [
  { name: "เอ", skill: 95 },
  { name: "บี", skill: 85 },
  { name: "ซี", skill: 72 },
  { name: "ดี", skill: 68 },
  { name: "อี", skill: 55 },
  { name: "เอฟ", skill: 50 },
  { name: "จี", skill: 35 },
  { name: "เอช", skill: 20 },
];
const NIGHT_HOST = "dddddddd-0000-0000-0000-00000000dddd";

// A fixed sequence, so two runs of this script print the same night.
let seed = 20261107;
const random = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

await db.exec(`insert into auth.users (id, email, raw_user_meta_data) values
  ('${NIGHT_HOST}', 'night@sandbox.test', '{"display_name":"${NIGHT[0].name}"}'),
  ${NIGHT.slice(1)
    .map((p, i) => `('eeeeeeee-0000-0000-0000-0000000000${String(i + 10).padStart(2, "0")}', '${p.name}@sandbox.test', '{"display_name":"${p.name}"}')`)
    .join(",\n  ")};`);
const nightIds = NIGHT.map((p, i) =>
  i === 0 ? NIGHT_HOST : `eeeeeeee-0000-0000-0000-0000000000${String(i + 9).padStart(2, "0")}`,
);

await as(ADMIN);
await db.query(`select set_party_host('${NIGHT_HOST}', true)`);
await as(NIGHT_HOST);
const night = await one(
  `select * from create_party_booking(3::smallint, '${startsAt}', 3, 'singles', 'ก๊วนเดี่ยว 8 คน', '${NIGHT[0].name}')`,
);
await db.exec(`update bookings set status = 'confirmed' where id = '${night.booking_id}'`);
for (let i = 1; i < NIGHT.length; i += 1) {
  await as(nightIds[i]);
  await db.query(
    `select join_party('${night.party_id}', '${NIGHT[i].name}', ${i + 1}::smallint, '${teamForSlot(i + 1)}'::party_team)`,
  );
}

const cap = (await one(`select win_streak_cap from party_rooms where id = '${night.party_id}'`)).win_streak_cap;
line(`   ผู้เล่น ${NIGHT.length} คน · ชนะติดกันได้ไม่เกิน ${cap} เกมแล้วต้องพัก`);

const skillOf = Object.fromEntries(NIGHT.map((p) => [p.name, p.skill]));
await as(NIGHT_HOST);
await db.query(`select advance_singles_match('${night.party_id}', null)`);

const held = [];
for (let game = 1; game <= 24; game += 1) {
  const m = await one(
    `select player_a_entry, player_a_name, player_b_entry, player_b_name
     from party_singles_match_board where party_id = '${night.party_id}' and status = 'playing'`,
  );
  if (!m) break;
  // The better player usually wins, but not always — that is what makes a rating useful.
  const edge = skillOf[m.player_a_name] / (skillOf[m.player_a_name] + skillOf[m.player_b_name]);
  const aWins = random() < edge;
  const winner = aWins ? m.player_a_entry : m.player_b_entry;
  held.push(aWins ? m.player_a_name : m.player_b_name);
  await db.query(`select advance_singles_match('${night.party_id}', '${winner}')`);
}

const table = await all(
  `select name, rating, rating_delta, played, wins, losses, best_streak
   from party_player_stats where party_id = '${night.party_id}' order by rating desc`,
);
line();
line("   อันดับหลังจบคืน            แต้ม   +/-   ลง  ชนะ  แพ้  ชนะติดสูงสุด   (ฝีมือจริง)");
for (const [i, r] of table.entries()) {
  const pad = (v, n) => String(v).padStart(n);
  line(
    `   ${pad(i + 1, 2)}. ${r.name.padEnd(6)}        ${pad(r.rating, 5)} ${pad(
      (r.rating_delta > 0 ? "+" : "") + r.rating_delta,
      5,
    )} ${pad(r.played, 3)} ${pad(r.wins, 4)} ${pad(r.losses, 4)} ${pad(r.best_streak, 8)}        ${pad(skillOf[r.name], 4)}`,
  );
}

const playedCounts = table.map((r) => r.played);
const spread = Math.max(...playedCounts) - Math.min(...playedCounts);
line();
expect(`ทุกคนได้ลงเล่น ไม่มีใครนั่งทั้งคืน (น้อยสุด ${Math.min(...playedCounts)} เกม)`, Math.min(...playedCounts) > 0);
expect(`เวลาลงสนามใกล้เคียงกัน ต่างกันไม่เกิน 2 เกม (ต่างจริง ${spread})`, spread <= 2);
expect(
  `ไม่มีใครครองสนามเกิน ${cap} เกมติด (สูงสุดที่ทำได้ ${Math.max(...table.map((r) => r.best_streak))})`,
  table.every((r) => r.best_streak <= cap),
);
expect("แต้มรวมไม่งอกไม่หาย (ได้เท่าที่อีกฝ่ายเสีย)", table.reduce((sum, r) => sum + r.rating_delta, 0) === 0);
const mostWins = [...table].sort((a, b) => b.wins - a.wins)[0];
const fewestWins = [...table].sort((a, b) => a.wins - b.wins)[0];
expect(`คนชนะมากที่สุด (${mostWins.name}) แต้มสูงกว่าคนชนะน้อยที่สุด (${fewestWins.name})`, mostWins.rating > fewestWins.rating);
const strongHalf = table.slice(0, 4).map((r) => skillOf[r.name]).reduce((a, b) => a + b, 0);
const weakHalf = table.slice(4).map((r) => skillOf[r.name]).reduce((a, b) => a + b, 0);
expect(`ตารางอันดับเรียงตามฝีมือจริงคร่าวๆ (ครึ่งบน ${strongHalf} > ครึ่งล่าง ${weakHalf})`, strongHalf > weakHalf);

const gaps = await all(
  `select round_no, player_a_name, player_b_name from party_singles_match_board
   where party_id = '${night.party_id}' and status = 'finished' order by round_no`,
);
const rematches = gaps.filter((m, i) => {
  const prev = gaps[i - 1];
  return prev && new Set([m.player_a_name, m.player_b_name]).size === 2 &&
    [prev.player_a_name, prev.player_b_name].sort().join() === [m.player_a_name, m.player_b_name].sort().join();
});
expect(`ไม่มีการเจอคู่เดิมซ้ำติดกันเลย (${gaps.length} เกม)`, rematches.length === 0);

// ---------------------------------------------------------------------------
head("7. แต้มที่หน้าเว็บบอกไว้ ตรงกับที่ฐานข้อมูลคิดจริง");
// The room shows "+12 / -12" on the winner buttons before the host taps one. That number
// comes from TypeScript; this one comes from the database. They have to agree.
for (const [winner, loser, points] of ELO_GRID) {
  const sql = await one(`select party_elo_delta(${winner}, ${loser}, true) as d`);
  expect(`${winner} ชนะ ${loser} ได้ ${points} แต้ม`, sql.d === points);
}

// ---------------------------------------------------------------------------
head("8. หัวห้องปรับกติกาได้");
await as(NIGHT_HOST);
await db.query(`select set_party_match_rules('${night.party_id}', 5::smallint)`);
const changed = await one(`select win_streak_cap from party_rooms where id = '${night.party_id}'`);
const boardCap = await one(`select win_streak_cap from party_room_board where party_id = '${night.party_id}'`);
expect(`เปลี่ยนเป็นชนะติดกันได้ ${changed.win_streak_cap} เกม และหน้าห้องเห็นค่าเดียวกัน`, changed.win_streak_cap === 5 && boardCap.win_streak_cap === 5);
await refused("ตั้งค่าเกินช่วงที่อนุญาตไม่ได้", `select set_party_match_rules('${night.party_id}', 99::smallint)`, "INVALID_STREAK_CAP");
await as(PLAYERS[0].id);
await refused("คนที่ไม่ใช่หัวห้องแก้กติกาไม่ได้", `select set_party_match_rules('${night.party_id}', 2::smallint)`, "FORBIDDEN");

line();
line(problems ? `พบปัญหา ${problems} จุด` : "ผ่านทั้งหมด — กฎใหม่ทำงานอย่างที่ออกแบบไว้ บนฐานข้อมูลใช้แล้วทิ้ง");
line("ฐานข้อมูลนี้หายไปพร้อมกับการจบสคริปต์ ไม่มีอะไรค้างอยู่ที่ไหน");
process.exit(problems ? 1 : 0);
