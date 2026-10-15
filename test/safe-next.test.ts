import { describe, expect, test } from "vitest";
import { safeNext } from "../src/lib/safe-next";

describe("safeNext", () => {
  test("keeps same-site relative paths", () => {
    expect(safeNext("/bookings/abc?x=1")).toBe("/bookings/abc?x=1");
  });

  test.each(["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "", undefined, 42])(
    "falls back to / for %s",
    (value) => {
      expect(safeNext(value)).toBe("/");
    },
  );
});
