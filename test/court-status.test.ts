import { describe, expect, test } from "vitest";
import { busyCourtIds, courtStatus, type OccupancyRow } from "../src/lib/court-status";
import { slotStart } from "../src/lib/slots";

/**
 * The public court-status number (src/app/api/court-status/route.ts).
 *
 * The counting is tested without a database: these are the rules ChivaGo's
 * place screen shows a student, so each one is pinned here rather than left to
 * a live read.
 */

const DATE = "2026-10-20";
// 2026-10-20 18:30 Bangkok, inside the 09:00-23:00 hours.
const NOW = Date.parse(slotStart(DATE, 18.5));
const COURTS = [1, 2, 3, 4];

const occ = (over: Partial<OccupancyRow> = {}): OccupancyRow => ({
  court_id: 1,
  state: "booked",
  starts_at: slotStart(DATE, 18),
  ends_at: slotStart(DATE, 20),
  hold_expires_at: null,
  ...over,
});

const status = (occupancy: OccupancyRow[], now = NOW) =>
  courtStatus({ courtIds: COURTS, occupancy, openHour: 9, closeHour: 23, now });

describe("busyCourtIds", () => {
  test("a booking over now takes its court", () => {
    expect([...busyCourtIds([occ()], new Set(COURTS), NOW)]).toEqual([1]);
  });

  test("a booking before or after now takes nothing", () => {
    const earlier = occ({ starts_at: slotStart(DATE, 10), ends_at: slotStart(DATE, 12) });
    const later = occ({ starts_at: slotStart(DATE, 20), ends_at: slotStart(DATE, 22) });
    expect(busyCourtIds([earlier, later], new Set(COURTS), NOW).size).toBe(0);
  });

  test("the slot a booking ends on is already free", () => {
    const row = occ({ starts_at: slotStart(DATE, 17), ends_at: slotStart(DATE, 18.5) });
    expect(busyCourtIds([row], new Set(COURTS), NOW).size).toBe(0);
  });

  test("a live hold takes its court; a lapsed one does not", () => {
    const live = occ({ state: "held", hold_expires_at: new Date(NOW + 60_000).toISOString() });
    const lapsed = occ({ state: "held", hold_expires_at: new Date(NOW - 1).toISOString() });
    expect(busyCourtIds([live], new Set(COURTS), NOW).size).toBe(1);
    // Migration 0002: the board shows a stale hold as free, so this must too.
    expect(busyCourtIds([lapsed], new Set(COURTS), NOW).size).toBe(0);
  });

  test("two rows on one court count it once", () => {
    const rows = [occ(), occ({ starts_at: slotStart(DATE, 18.5), ends_at: slotStart(DATE, 19) })];
    expect(busyCourtIds(rows, new Set(COURTS), NOW).size).toBe(1);
  });

  test("a row for a court the venue switched off is ignored", () => {
    expect(busyCourtIds([occ({ court_id: 9 })], new Set(COURTS), NOW).size).toBe(0);
  });

  test("an unparseable time is not taken as a booking", () => {
    expect(busyCourtIds([occ({ starts_at: "not a time" })], new Set(COURTS), NOW).size).toBe(0);
  });
});

describe("courtStatus", () => {
  test("an empty floor is every court free", () => {
    expect(status([])).toMatchObject({ total: 4, free: 4, busy: 0, openNow: true, nextOpenAt: null });
  });

  test("free and busy always add up to the courts the venue has", () => {
    const r = status([occ({ court_id: 1 }), occ({ court_id: 2 })]);
    expect(r).toMatchObject({ total: 4, free: 2, busy: 2 });
    expect(r.free + r.busy).toBe(r.total);
  });

  test("a full floor is zero free, not a missing answer", () => {
    expect(status(COURTS.map((id) => occ({ court_id: id })))).toMatchObject({ total: 4, free: 0, busy: 4 });
  });

  test("free cannot exceed the floor, however many rows arrive", () => {
    const rows = [...COURTS, 7, 8, 9].map((id) => occ({ court_id: id }));
    const r = status(rows);
    expect(r.free).toBe(0);
    expect(r.busy).toBeLessThanOrEqual(r.total);
  });

  test("before opening it is shut, and says when it opens today", () => {
    const r = status([], Date.parse(slotStart(DATE, 7)));
    expect(r.openNow).toBe(false);
    expect(r.nextOpenAt).toBe(Date.parse(slotStart(DATE, 9)));
    // The count is still the count: a shut venue is not reported as full.
    expect(r.free).toBe(4);
  });

  test("after closing it is shut, and says when it opens tomorrow", () => {
    const r = status([], Date.parse(slotStart(DATE, 23.5)));
    expect(r.openNow).toBe(false);
    expect(r.nextOpenAt).toBe(Date.parse(slotStart("2026-10-21", 9)));
  });

  test("the reading is stamped with the moment it was taken", () => {
    expect(status([]).observedAt).toBe(NOW);
  });

  test("hours come from the venue, not from the built-in constants", () => {
    const late = courtStatus({ courtIds: COURTS, occupancy: [], openHour: 9, closeHour: 19, now: NOW });
    expect(late.openNow).toBe(true);
    const shut = courtStatus({ courtIds: COURTS, occupancy: [], openHour: 9, closeHour: 18, now: NOW });
    expect(shut.openNow).toBe(false);
  });
});
