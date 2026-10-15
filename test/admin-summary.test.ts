import { describe, expect, test } from "vitest";
import { confirmedRevenue, monthBounds, summarizeDay } from "../src/lib/admin/summary";

const b = (status: string, amount: number | string, from: string, to: string) => ({
  status,
  amount,
  starts_at: `2026-10-20T${from}:00+07:00`,
  ends_at: `2026-10-20T${to}:00+07:00`,
});

describe("confirmedRevenue", () => {
  test("adds confirmed bookings only, without floating point drift", () => {
    expect(
      confirmedRevenue([
        b("confirmed", 260.37, "17", "19"),
        b("confirmed", "130.21", "19", "20"),
        b("pending_payment", 260.55, "20", "22"),
        b("cancelled", 130, "09", "10"),
      ]),
    ).toBe(390.58);
  });

  test("is zero for no bookings", () => {
    expect(confirmedRevenue([])).toBe(0);
  });
});

describe("summarizeDay", () => {
  test("counts confirmed and waiting bookings and court utilization", () => {
    const summary = summarizeDay(
      [
        b("confirmed", 260, "17", "19"),
        b("confirmed", 390, "18", "21"),
        b("awaiting_review", 130.5, "20", "21"),
        b("pending_payment", 130.4, "21", "22"),
      ],
      4,
    );
    expect(summary).toEqual({ revenue: 650, confirmedCount: 2, waitingCount: 2, bookedHours: 5, utilization: 9 });
  });
});

describe("monthBounds", () => {
  test("handles a normal month and December", () => {
    expect(monthBounds("2026-10-20")).toEqual({ start: "2026-10-01", next: "2026-11-01" });
    expect(monthBounds("2026-12-31")).toEqual({ start: "2026-12-01", next: "2027-01-01" });
  });
});
