import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { friendlyError } from "../src/lib/errors";

const migrationsDir = fileURLToPath(new URL("../supabase/migrations", import.meta.url));

/** Every code the SQL can raise, read straight from the migrations. */
function sqlErrorCodes(): string[] {
  const codes = new Set<string>();
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"))) {
    const sql = readFileSync(`${migrationsDir}/${file}`, "utf8");
    for (const m of sql.matchAll(/raise exception '([A-Z_0-9]+)'/g)) codes.add(m[1]);
  }
  return [...codes].sort();
}

describe("friendlyError", () => {
  // Two migrations added codes nobody mapped, so a singles host who tapped "เริ่มคู่แรก"
  // one player short was shown the raw "NOT_ENOUGH_READY_PLAYERS". This keeps that from
  // happening again the next time a migration raises something new.
  test("has a Thai message for every error the database can raise", () => {
    const unmapped = sqlErrorCodes().filter((code) => friendlyError({ message: code }).includes(code));
    expect(unmapped).toEqual([]);
  });

  test("explains the singles matching errors in Thai", () => {
    expect(friendlyError({ message: "NOT_ENOUGH_READY_PLAYERS" })).toBe("ต้องมีผู้เล่นในห้องอย่างน้อย 2 คนจึงจะเริ่มแข่งได้");
    expect(friendlyError({ message: "INVALID_PARTY_MODE" })).toBe("ห้องนี้ไม่ใช่ห้องเดี่ยว จึงจับคู่แบบผู้เล่นเดี่ยวไม่ได้");
  });

  test("still falls back for a code it has never seen", () => {
    expect(friendlyError({ message: "SOMETHING_NEW" })).toBe("เกิดข้อผิดพลาด: SOMETHING_NEW");
    expect(friendlyError(null)).toBe("เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง");
  });
});
