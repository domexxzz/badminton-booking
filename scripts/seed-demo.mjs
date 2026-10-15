// Fills a Supabase project with demo users and bookings so the board looks alive.
// Runs against localhost, or a cloud DEV project only with ALLOW_REMOTE_DEMO_SEED=1.
// Never run it against the shop's live project. Usage: npm run seed:demo
import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "node:fs";

function loadEnv(file) {
  try {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* optional */
  }
}
loadEnv(new URL("../.env.local", import.meta.url));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const isLocal = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url);
if (!url || (!isLocal && process.env.ALLOW_REMOTE_DEMO_SEED !== "1")) {
  console.error(
    `Refusing to seed ${url || "(no NEXT_PUBLIC_SUPABASE_URL)"}: set ALLOW_REMOTE_DEMO_SEED=1 for a cloud DEV project.`,
  );
  process.exit(1);
}
if (!serviceKey) {
  console.error("SUPABASE_SERVICE_ROLE_KEY missing in .env.local");
  process.exit(1);
}

const db = createClient(url, serviceKey, { auth: { persistSession: false } });
const SITE = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

async function ensureUser(email, name) {
  const { data: list, error } = await db.auth.admin.listUsers({ perPage: 200 });
  if (error) throw error;
  const found = list.users.find((u) => u.email === email);
  if (found) return found.id;
  const { data, error: createError } = await db.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { display_name: name },
  });
  if (createError) throw createError;
  return data.user.id;
}

// Bangkok wall-clock hour on a day offset from today -> ISO instant.
function at(dayOffset, hour) {
  const bkkToday = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
  const base = Date.parse(`${bkkToday}T00:00:00+07:00`);
  return new Date(base + dayOffset * 86400e3 + hour * 3600e3).toISOString();
}

async function loginLink(email, next) {
  const { data, error } = await db.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw error;
  return `${SITE}/auth/callback?token_hash=${data.properties.hashed_token}&type=magiclink&next=${encodeURIComponent(next)}`;
}

const adminId = await ensureUser("admin@demo.test", "แอดมินร้าน");
const customerId = await ensureUser("somchai@demo.test", "สมชาย ใจดี");
await db.from("profiles").update({ is_admin: true, phone: "0800000000" }).eq("id", adminId);

// Fresh demo bookings each run.
await db.from("bookings").delete().in("user_id", [adminId, customerId]);
const now = new Date(Date.now() + 7 * 3600e3).getUTCHours(); // Bangkok hour
const later = Math.min(Math.max(now + 1, 9), 20);
const rows = [
  // Phone / LINE bookings an admin entered (most of this shop's customers)
  { court_id: 1, day: 0, hour: 17, hours: 2, channel: "phone", customer_name: "คุณเอก", customer_phone: "0811111111" },
  { court_id: 2, day: 0, hour: 18, hours: 3, channel: "line", customer_name: "ก๊วนวันอังคาร", customer_phone: null },
  { court_id: 3, day: 0, hour: 19, hours: 2, channel: "walk_in", customer_name: "น้องบี", customer_phone: null },
  { court_id: 4, day: 1, hour: 17, hours: 2, channel: "phone", customer_name: "คุณต้น", customer_phone: "0822222222" },
  { court_id: 1, day: 1, hour: 20, hours: 2, channel: "line", customer_name: "ทีมออฟฟิศ", customer_phone: null },
].map((r) => ({
  court_id: r.court_id,
  user_id: adminId,
  starts_at: at(r.day, r.hour),
  ends_at: at(r.day, r.hour + r.hours),
  amount: 130 * r.hours,
  status: "confirmed",
  channel: r.channel,
  customer_name: r.customer_name,
  customer_phone: r.customer_phone,
}));
// Online customer: one confirmed, one waiting for payment (shows as "รอชำระ" on the board).
rows.push(
  {
    court_id: 4, user_id: customerId, starts_at: at(0, 20), ends_at: at(0, 22),
    amount: 260.37, status: "confirmed", channel: "online",
  },
  {
    court_id: 3, user_id: customerId, starts_at: at(1, later), ends_at: at(1, later + 1),
    amount: 130.21, status: "pending_payment", channel: "online",
    hold_expires_at: new Date(Date.now() + 15 * 60e3).toISOString(),
  },
);
const { error: insertError } = await db.from("bookings").insert(rows);
if (insertError) throw insertError;

console.log(`Seeded ${rows.length} bookings.`);
// One-time login links are credentials: write them to a file when asked, not the terminal.
const links = [
  `Admin (one-time): ${await loginLink("admin@demo.test", "/admin")}`,
  `Customer (one-time): ${await loginLink("somchai@demo.test", "/")}`,
].join("\n");
if (process.env.DEMO_LINKS_FILE) {
  writeFileSync(process.env.DEMO_LINKS_FILE, `${links}\n`);
  console.log(`Login links written to ${process.env.DEMO_LINKS_FILE}`);
} else {
  console.log(`\n${links}`);
}
