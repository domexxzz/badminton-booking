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
    // Both advance_singles_match and advance_party_match raise it since 0029, so the
    // wording cannot name one mode.
    expect(friendlyError({ message: "INVALID_PARTY_MODE" })).toBe("โหมดของห้องไม่ตรงกับการจับคู่แบบนี้ กรุณารีเฟรชหน้าแล้วลองใหม่");
    expect(friendlyError({ message: "INVALID_STREAK_CAP" })).toBe("จำนวนเกมที่ชนะติดกันได้ ต้องอยู่ระหว่าง 1 ถึง 10 เกม");
  });

  test("still falls back for a code it has never seen", () => {
    expect(friendlyError({ message: "SOMETHING_NEW" })).toBe("เกิดข้อผิดพลาด: SOMETHING_NEW");
    expect(friendlyError(null)).toBe("เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง");
  });
});
