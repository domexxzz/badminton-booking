import { describe, expect, test } from "vitest";
import { canSelfCancel, selfCancelDeadline } from "../src/lib/cancel-policy";

const at = (iso: string) => new Date(iso);

describe("selfCancelDeadline", () => {
  test("an evening booking can be cancelled until 12:00 on the day of play", () => {
    expect(selfCancelDeadline("2026-10-20T11:00:00.000Z").toISOString()) // 18:00 Bangkok
      .toBe(at("2026-10-20T12:00:00+07:00").toISOString());
  });

  test("a morning booking can be cancelled until it starts", () => {
    expect(selfCancelDeadline("2026-10-20T02:30:00.000Z").toISOString()) // 09:30 Bangkok
      .toBe(at("2026-10-20T09:30:00+07:00").toISOString());
  });

  test("uses the Bangkok date, not the UTC date", () => {
    // 22:00 Bangkok on the 20th is 15:00 UTC on the 20th; 06:00 Bangkok on the 21st is 23:00 UTC on the 20th.
    expect(selfCancelDeadline("2026-10-20T23:30:00.000Z").toISOString()) // 06:30 Bangkok, 21st
      .toBe(at("2026-10-21T06:30:00+07:00").toISOString());
  });
});

describe("canSelfCancel", () => {
  const evening = "2026-10-20T11:00:00.000Z"; // 18:00 Bangkok

  test("allows cancelling before noon of the day", () => {
    expect(canSelfCancel(evening, at("2026-10-20T11:59:00+07:00"))).toBe(true);
    expect(canSelfCancel(evening, at("2026-10-19T20:00:00+07:00"))).toBe(true);
  });

  test("refuses from 12:00 onwards", () => {
    expect(canSelfCancel(evening, at("2026-10-20T12:00:00+07:00"))).toBe(false);
    expect(canSelfCancel(evening, at("2026-10-20T17:00:00+07:00"))).toBe(false);
  });
});
