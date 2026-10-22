import { describe, expect, it } from "vitest";
import {
  formatMinute,
  isLessonHours,
  isValidSlot,
  lessonFee,
  lessonTotal,
  parseMinute,
  slotsByWeekday,
  summariseAvailability,
  toStartTimes,
} from "../src/lib/coach";

describe("formatMinute and parseMinute", () => {
  it("round-trips half-hour times of day", () => {
    expect(formatMinute(0)).toBe("00:00");
    expect(formatMinute(1110)).toBe("18:30");
    expect(formatMinute(1440)).toBe("24:00");
    expect(parseMinute("18:30")).toBe(1110);
    expect(parseMinute(" 9:00 ")).toBe(540);
  });

  it("rejects anything that is not a half hour", () => {
    expect(parseMinute("18:45")).toBeNull();
    expect(parseMinute("25:00")).toBeNull();
    expect(parseMinute("evening")).toBeNull();
  });
});

describe("isValidSlot", () => {
  it("accepts what the database accepts", () => {
    expect(isValidSlot({ weekday: 1, start_minute: 1020, end_minute: 1260 })).toBe(true);
  });

  it("rejects a backwards, off-grid or out-of-range slot", () => {
    expect(isValidSlot({ weekday: 1, start_minute: 1260, end_minute: 1020 })).toBe(false);
    expect(isValidSlot({ weekday: 1, start_minute: 1020, end_minute: 1021 })).toBe(false);
    expect(isValidSlot({ weekday: 7, start_minute: 600, end_minute: 660 })).toBe(false);
    expect(isValidSlot({ weekday: 1, start_minute: 600, end_minute: 1470 })).toBe(false);
  });
});

describe("slotsByWeekday and summariseAvailability", () => {
  const slots = [
    { weekday: 6, start_minute: 540, end_minute: 720 },
    { weekday: 1, start_minute: 1200, end_minute: 1260 },
    { weekday: 1, start_minute: 1020, end_minute: 1140 },
  ];

  it("keeps one list per weekday, sorted by time", () => {
    const byDay = slotsByWeekday(slots);
    expect(byDay).toHaveLength(7);
    expect(byDay[0]).toEqual([]);
    expect(byDay[1].map((s) => s.start_minute)).toEqual([1020, 1200]);
  });

  it("reads as a short line for a coach card", () => {
    expect(summariseAvailability(slots)).toBe("จ 17:00–19:00 · จ 20:00–21:00 · ส 09:00–12:00");
    expect(summariseAvailability([])).toBe("");
  });
});

describe("toStartTimes", () => {
  it("accepts bare timestamps or one-key rows from the RPC", () => {
    const iso = "2026-10-25T12:00:00+00:00";
    expect(toStartTimes([iso])).toEqual([iso]);
    expect(toStartTimes([{ coach_open_starts: iso }])).toEqual([iso]);
  });

  it("drops anything that is not a timestamp", () => {
    expect(toStartTimes(null)).toEqual([]);
    expect(toStartTimes("not an array")).toEqual([]);
    expect(toStartTimes(["later today", 5, null, {}])).toEqual([]);
  });
});

describe("lesson prices", () => {
  it("adds the lesson fee to the court price", () => {
    expect(lessonFee(300, 1.5)).toBe(450);
    expect(lessonTotal(130, 300, 1.5)).toBe(195 + 450);
  });

  it("keeps whole baht on a half hour", () => {
    expect(lessonTotal(130, 250, 0.5)).toBe(65 + 125);
  });

  it("only offers the durations the database allows", () => {
    expect(isLessonHours(1)).toBe(true);
    expect(isLessonHours(3)).toBe(true);
    expect(isLessonHours(0.5)).toBe(false);
    expect(isLessonHours(4)).toBe(false);
  });
});
