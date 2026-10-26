import { describe, expect, test } from "vitest";
import { confirmedRevenue, countBookings, monthBounds, owedAmount, summarizeDay } from "../src/lib/admin/summary";

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
    expect(summary).toEqual({ revenue: 650, owed: 0, confirmedCount: 2, waitingCount: 2, bookedHours: 5, utilization: 9 });
  });
});

describe("money owed by pay-later bookings", () => {
  const owed = { ...b("confirmed", 130, "17", "18"), pay_later: true, paid_at: null };
  const settled = { ...b("confirmed", 260, "18", "20"), pay_later: true, paid_at: "2026-10-20T13:00:00Z" };
  const paid = b("confirmed", 195, "20", "21");

  test("revenue counts money received, not a pay-later bill still owed", () => {
    expect(confirmedRevenue([owed, settled, paid])).toBe(455);
  });

  test("owedAmount adds up what pay-later customers still owe", () => {
    expect(owedAmount([owed, settled, paid, { ...owed, amount: 65.5 }])).toBe(195.5);
    expect(owedAmount([paid])).toBe(0);
  });

  test("a day's summary keeps owed money out of revenue but its court time in", () => {
    const summary = summarizeDay([owed, paid], 4);
    expect(summary.revenue).toBe(195);
    expect(summary.owed).toBe(130);
    expect(summary.bookedHours).toBe(2);
  });
});

describe("countBookings", () => {
  test("keeps cancelled and expired out of the active count", () => {
    expect(
      countBookings([
        b("confirmed", 130, "17", "18"),
        b("confirmed", 130, "18", "19"),
        b("awaiting_review", 130, "19", "20"),
        b("pending_payment", 130, "20", "21"),
        b("cancelled", 130, "09", "10"),
        b("expired", 130, "10", "11"),
        b("expired", 130, "11", "12"),
      ]),
    ).toEqual({ confirmed: 2, waiting: 2, dropped: 3, active: 4 });
  });

  test("is all zeros for no bookings", () => {
    expect(countBookings([])).toEqual({ confirmed: 0, waiting: 0, dropped: 0, active: 0 });
  });

  test("ignores a status it does not know", () => {
    expect(countBookings([{ status: "something_new" }])).toEqual({
      confirmed: 0,
      waiting: 0,
      dropped: 0,
      active: 0,
    });
  });
});

describe("monthBounds", () => {
  test("handles a normal month and December", () => {
    expect(monthBounds("2026-10-20")).toEqual({ start: "2026-10-01", next: "2026-11-01" });
    expect(monthBounds("2026-12-31")).toEqual({ start: "2026-12-01", next: "2027-01-01" });
  });
});
