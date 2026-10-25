import { describe, expect, test, vi } from "vitest";
import {
  createDailySummaryHandler,
  formatTelegramDailySummary,
  summaryDays,
  type DailySummaryBooking,
} from "../src/lib/telegram/daily-summary";

const COURTS = [
  { id: 1, name: "สนาม 1" },
  { id: 2, name: "สนาม 2" },
];

const b = (court_id: number, status: string, amount: number, from: string, to: string, day = "2026-10-25") => ({
  court_id,
  status,
  amount,
  starts_at: `${day}T${from}:00+07:00`,
  ends_at: `${day}T${to}:00+07:00`,
});

const NO_PENDING = { awaitingReview: 0, cancelRequests: 0, rescheduleRequests: 0 };

describe("summaryDays", () => {
  test("closing summary just after midnight covers the day that just ended", () => {
    expect(summaryDays("closing", new Date("2026-10-25T17:15:00Z"))).toEqual({ day: "2026-10-25", nextDay: "2026-10-26" });
  });

  test("closing summary sent late in the evening covers the same day", () => {
    expect(summaryDays("closing", new Date("2026-10-25T15:00:00Z"))).toEqual({ day: "2026-10-25", nextDay: "2026-10-26" });
  });

  test("morning summary covers today", () => {
    expect(summaryDays("morning", new Date("2026-10-26T01:00:00Z"))).toEqual({ day: "2026-10-26", nextDay: null });
  });
});

describe("formatTelegramDailySummary", () => {
  const dayBookings: DailySummaryBooking[] = [
    b(1, "confirmed", 260, "18:00", "19:00"),
    b(1, "confirmed", 130, "19:00", "20:00"),
    b(1, "confirmed", 65, "21:30", "22:00"),
    b(2, "awaiting_review", 130, "20:00", "21:00"),
    b(2, "cancelled", 130, "09:00", "10:00"),
    b(2, "expired", 130, "10:00", "11:00"),
  ];

  test("closing summary shows revenue, counts, per-court hours, admin work and the next day", () => {
    const text = formatTelegramDailySummary({
      kind: "closing",
      day: "2026-10-25",
      courts: COURTS,
      bookings: dayBookings,
      pending: { awaitingReview: 1, cancelRequests: 2, rescheduleRequests: 0 },
      nextDay: { day: "2026-10-26", bookings: [b(1, "confirmed", 260, "17:00", "19:00", "2026-10-26")] },
    });

    expect(text).toMatch(/สรุปยอดปิดวัน · \S+ 25 ต\.ค\./);
    expect(text).toContain("รายรับ:</b> ฿455");
    expect(text).toContain("ยืนยัน 3 · รอชำระ/รอตรวจ 1 · ยกเลิก/หมดเวลา 2");
    // Back-to-back bookings merge into one range.
    expect(text).toContain("สนาม 1: 2.5 ชม. (18:00–20:00, 21:30–22:00)");
    expect(text).toContain("สนาม 2: ไม่มีการจอง");
    expect(text).toContain("สลิปรอตรวจ 1");
    expect(text).toContain("คำขอยกเลิก/คืนเงิน 2");
    expect(text).not.toContain("คำขอเลื่อน");
    expect(text).toMatch(/จองไว้แล้วสำหรับ \S+ 26 ต\.ค\.:<\/b> ยืนยัน 1 · 2 ชม\./);
  });

  test("morning summary leaves out the next-day section", () => {
    const text = formatTelegramDailySummary({
      kind: "morning",
      day: "2026-10-25",
      courts: COURTS,
      bookings: dayBookings,
      pending: NO_PENDING,
    });

    expect(text).toMatch(/สรุปเช้านี้ · \S+ 25 ต\.ค\./);
    expect(text).toContain("ไม่มีงานค้าง");
    expect(text).not.toContain("จองไว้แล้วสำหรับ");
  });

  test("shows a closing at midnight as 24:00 and escapes court names", () => {
    const text = formatTelegramDailySummary({
      kind: "morning",
      day: "2026-10-25",
      courts: [{ id: 1, name: "สนาม <VIP>" }],
      bookings: [{ court_id: 1, status: "confirmed", amount: 130, starts_at: "2026-10-25T23:00:00+07:00", ends_at: "2026-10-26T00:00:00+07:00" }],
      pending: NO_PENDING,
    });

    expect(text).toContain("สนาม &lt;VIP&gt;: 1 ชม. (23:00–24:00)");
  });
});

describe("createDailySummaryHandler", () => {
  const post = (query: string, auth?: string) =>
    new Request(`https://example.test/api/telegram/daily-summary${query}`, {
      method: "POST",
      headers: auth ? { authorization: auth } : {},
    });

  test("refuses to run when no secret is configured", async () => {
    const send = vi.fn(async () => true);
    const res = await createDailySummaryHandler({ secret: undefined, send })(post("?kind=morning", "Bearer x"));
    expect(res.status).toBe(503);
    expect(send).not.toHaveBeenCalled();
  });

  test("rejects a wrong or missing token", async () => {
    const send = vi.fn(async () => true);
    const handler = createDailySummaryHandler({ secret: "s3cret", send });
    expect((await handler(post("?kind=morning"))).status).toBe(401);
    expect((await handler(post("?kind=morning", "Bearer nope"))).status).toBe(401);
    expect(send).not.toHaveBeenCalled();
  });

  test("rejects an unknown kind", async () => {
    const send = vi.fn(async () => true);
    const res = await createDailySummaryHandler({ secret: "s3cret", send })(post("?kind=weekly", "Bearer s3cret"));
    expect(res.status).toBe(400);
    expect(send).not.toHaveBeenCalled();
  });

  test("sends the requested summary", async () => {
    const send = vi.fn(async () => true);
    const res = await createDailySummaryHandler({ secret: "s3cret", send })(post("?kind=closing", "Bearer s3cret"));
    expect(res.status).toBe(200);
    expect(send).toHaveBeenCalledWith("closing");
  });

  test("reports a failed send so the scheduler shows it", async () => {
    const send = vi.fn(async () => false);
    const res = await createDailySummaryHandler({ secret: "s3cret", send })(post("?kind=morning", "Bearer s3cret"));
    expect(res.status).toBe(502);
  });
});
