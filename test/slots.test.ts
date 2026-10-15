import { describe, expect, test } from "vitest";
import {
  applyOccupancyChange,
  bangkokDate,
  cellState,
  maxBookableHours,
  openingHours,
  slotStart,
  upcomingDates,
  type Occupancy,
} from "../src/lib/slots";

const DATE = "2026-10-20";
// 2026-10-20 09:30 Bangkok
const NOW = new Date("2026-10-20T02:30:00Z");

const occ = (overrides: Partial<Occupancy>): Occupancy => ({
  booking_id: "b1",
  court_id: 1,
  starts_at: slotStart(DATE, 18),
  ends_at: slotStart(DATE, 20),
  state: "booked",
  hold_expires_at: null,
  ...overrides,
});

describe("time helpers", () => {
  test("slotStart converts Bangkok wall time to UTC", () => {
    expect(slotStart(DATE, 18)).toBe("2026-10-20T11:00:00.000Z");
    expect(slotStart(DATE, 24)).toBe("2026-10-20T17:00:00.000Z");
  });

  test("bangkokDate rolls over at Bangkok midnight, not UTC midnight", () => {
    expect(bangkokDate(new Date("2026-10-20T16:59:00Z"))).toBe("2026-10-20");
    expect(bangkokDate(new Date("2026-10-20T17:00:00Z"))).toBe("2026-10-21");
  });

  test("upcomingDates starts today in Bangkok", () => {
    expect(upcomingDates(new Date("2026-10-31T18:00:00Z"), 3)).toEqual([
      "2026-11-01",
      "2026-11-02",
      "2026-11-03",
    ]);
  });

  test("openingHours covers 09:00 through 22:00 (closing at 23:00)", () => {
    const hours = openingHours();
    expect(hours[0]).toBe(9);
    expect(hours.at(-1)).toBe(22);
  });
});

describe("cellState", () => {
  test("marks every hour inside a booking as booked", () => {
    const list = [occ({})];
    expect(cellState(1, DATE, 18, list, NOW)).toBe("booked");
    expect(cellState(1, DATE, 19, list, NOW)).toBe("booked");
    expect(cellState(1, DATE, 20, list, NOW)).toBe("free");
    expect(cellState(2, DATE, 18, list, NOW)).toBe("free");
  });

  test("shows a live hold as held", () => {
    const list = [occ({ state: "held", hold_expires_at: "2026-10-20T02:40:00Z" })];
    expect(cellState(1, DATE, 18, list, NOW)).toBe("held");
  });

  test("treats a lapsed hold as free", () => {
    const list = [occ({ state: "held", hold_expires_at: "2026-10-20T02:00:00Z" })];
    expect(cellState(1, DATE, 18, list, NOW)).toBe("free");
  });

  test("marks hours that already started as past", () => {
    expect(cellState(1, DATE, 9, [], NOW)).toBe("past");
    expect(cellState(1, DATE, 10, [], NOW)).toBe("free");
  });
});

describe("maxBookableHours", () => {
  test("stops at the next booking", () => {
    expect(maxBookableHours(1, DATE, 16, [occ({})], NOW)).toBe(2);
  });

  test("stops at closing time", () => {
    expect(maxBookableHours(1, DATE, 21, [], NOW)).toBe(2);
  });

  test("caps at the max duration", () => {
    expect(maxBookableHours(1, DATE, 10, [], NOW)).toBe(4);
  });

  test("is zero for a taken slot", () => {
    expect(maxBookableHours(1, DATE, 18, [occ({})], NOW)).toBe(0);
  });
});

describe("applyOccupancyChange", () => {
  test("inserts, updates and deletes without mutating the input", () => {
    const original = [occ({ state: "held" })];

    const updated = applyOccupancyChange(original, { eventType: "UPDATE", new: occ({ state: "booked" }) });
    expect(updated).toHaveLength(1);
    expect(updated[0].state).toBe("booked");
    expect(original[0].state).toBe("held");

    const inserted = applyOccupancyChange(updated, { eventType: "INSERT", new: occ({ booking_id: "b2" }) });
    expect(inserted).toHaveLength(2);

    const deleted = applyOccupancyChange(inserted, { eventType: "DELETE", old: { booking_id: "b1" } });
    expect(deleted.map((o) => o.booking_id)).toEqual(["b2"]);
  });
});
