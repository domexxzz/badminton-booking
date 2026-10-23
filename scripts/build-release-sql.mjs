// Glues the migrations that have not been run yet into one file to paste into the
// Supabase SQL Editor, wrapped in a single transaction.
//
// Why one file instead of four pastes: a transaction either applies all of it or none of
// it. Four pastes can stop halfway and leave the database in a state nobody designed —
// two of four migrations applied, with the site's code expecting all four. This way a
// mistake costs nothing but a second attempt.
//
// Usage: npm run build:release-sql -- 0029 0030 0031 0032
import { readFileSync, readdirSync, writeFileSync } from "node:fs";

const MIG = new URL("../supabase/migrations/", import.meta.url);
const prefixes = process.argv.slice(2).filter((a) => /^\d{4}$/.test(a));
if (prefixes.length === 0) {
  console.error("บอกเลข migration ที่จะรวมด้วย เช่น: npm run build:release-sql -- 0029 0030 0031 0032");
  process.exit(1);
}

const all = readdirSync(MIG).filter((f) => f.endsWith(".sql")).sort();
const files = prefixes.map((p) => {
  const found = all.find((f) => f.startsWith(p));
  if (!found) {
    console.error(`ไม่พบ migration ที่ขึ้นต้นด้วย ${p}`);
    process.exit(1);
  }
  return found;
});

const first = prefixes[0];
const last = prefixes[prefixes.length - 1];
const out = new URL(`../supabase/ops/release-${first}-to-${last}.sql`, import.meta.url);

const header = `-- ============================================================================
-- รันครั้งเดียวจบ: migration ${prefixes.join(", ")}
-- สร้างอัตโนมัติจากไฟล์ใน supabase/migrations/ อย่าแก้ไฟล์นี้ด้วยมือ
-- สร้างใหม่ได้ด้วย: npm run build:release-sql -- ${prefixes.join(" ")}
--
-- วิธีใช้: เปิด Supabase -> SQL Editor -> วางทั้งหมด -> Run
--
-- ทั้งหมดอยู่ใน transaction เดียว ถ้ามีบรรทัดไหนพัง ฐานข้อมูลจะคืนสภาพเดิมทั้งหมด
-- เหมือนไม่เคยรัน ไม่มีสภาพค้างครึ่งๆ กลางๆ และแก้แล้วรันซ้ำได้เลย
--
-- ซ้อมก่อนด้วย: npm run rehearse
-- ============================================================================

begin;

`;

const body = files
  .map((f) => {
    // The schema-cache reload is a signal to the API server, not DDL. It belongs after
    // the commit, so it is stripped here and added once at the end.
    const sql = readFileSync(new URL(f, MIG), "utf8").replace(/notify pgrst, 'reload schema';/g, "");
    return `-- >>>>>>>>>>>>>>>>>>>>>>  ${f}  <<<<<<<<<<<<<<<<<<<<<<\n\n${sql.trim()}\n`;
  })
  .join("\n\n");

const footer = `
commit;

-- บอก API ให้โหลดโครงสร้างใหม่ (ต้องอยู่นอก transaction)
notify pgrst, 'reload schema';
`;

writeFileSync(out, header + body + footer, "utf8");
console.log(`wrote ${out.pathname.split("/").pop()} from ${files.length} migrations`);
