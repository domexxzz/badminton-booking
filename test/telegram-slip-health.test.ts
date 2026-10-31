import { describe, expect, test } from "vitest";
import {
  SLIP_ALERT_REPEAT_MS,
  isSlipCheckerDown,
  shouldAlertSlipFailure,
  slipFailureAdvice,
  slipFailureCode,
  slipFailureKey,
} from "../src/lib/telegram/slip-health";
import { formatTelegramSlipCheckDown } from "../src/lib/telegram/messages";

// The real reasons recorded on the live database between 22 and 31 Oct 2026.
const EXPIRED = ["ตรวจสลิปอัตโนมัติไม่สำเร็จ (SERVICE_EXPIRED)"];
const VALIDATION = ["ตรวจสลิปอัตโนมัติไม่สำเร็จ (VALIDATION_ERROR)"];
const PENDING = ["ธนาคารยังไม่ยืนยันรายการ (สลิปกรุงเทพฯ ที่โอนไม่ถึง 5 นาที) ให้กดตรวจอีกครั้งภายหลัง"];
const QUOTA = ["โควตาตรวจสลิปของ EasySlip เต็มแล้ว"];

describe("isSlipCheckerDown", () => {
  test("an expired package is the shop's problem", () => {
    expect(isSlipCheckerDown("error", EXPIRED)).toBe(true);
  });

  test("a Bangkok Bank slip the bank has not confirmed yet is not", () => {
    expect(isSlipCheckerDown("error", PENDING)).toBe(false);
  });

  test("a slip that merely needs review is not", () => {
    expect(isSlipCheckerDown("mismatch", ["ยอดเงิน: ฿40.00 (ไม่ตรงกับยอดที่ต้องชำระ ฿130.00)"])).toBe(false);
    expect(isSlipCheckerDown("unreadable", ["รูปที่อัปโหลดไม่ใช่สลิปธนาคาร"])).toBe(false);
    expect(isSlipCheckerDown("verified", [])).toBe(false);
    expect(isSlipCheckerDown(null, [])).toBe(false);
  });

  test("an error with nothing recorded is not reported, since there is nothing to say", () => {
    expect(isSlipCheckerDown("error", [])).toBe(false);
    expect(isSlipCheckerDown("error", ["   "])).toBe(false);
  });
});

describe("shouldAlertSlipFailure", () => {
  const now = Date.parse("2026-10-29T08:41:00+07:00");

  test("the first failure goes out at once", () => {
    expect(shouldAlertSlipFailure({ verifyStatus: "error", reasons: EXPIRED, last: null, now })).toBe(true);
  });

  test("the same failure again stays quiet", () => {
    const last = { key: slipFailureKey(EXPIRED), at: now };
    expect(
      shouldAlertSlipFailure({ verifyStatus: "error", reasons: EXPIRED, last, now: now + 60_000 }),
    ).toBe(false);
  });

  test("the same failure is repeated once the quiet window is over", () => {
    const last = { key: slipFailureKey(EXPIRED), at: now };
    expect(
      shouldAlertSlipFailure({ verifyStatus: "error", reasons: EXPIRED, last, now: now + SLIP_ALERT_REPEAT_MS }),
    ).toBe(true);
  });

  test("a different failure is never swallowed by the quiet window", () => {
    const last = { key: slipFailureKey(EXPIRED), at: now };
    expect(
      shouldAlertSlipFailure({ verifyStatus: "error", reasons: QUOTA, last, now: now + 60_000 }),
    ).toBe(true);
  });

  test("a pending bank slip never alerts, even as the first one seen", () => {
    expect(shouldAlertSlipFailure({ verifyStatus: "error", reasons: PENDING, last: null, now })).toBe(false);
  });
});

describe("slipFailureCode", () => {
  test("reads the provider code out of the recorded reason", () => {
    expect(slipFailureCode(EXPIRED)).toBe("SERVICE_EXPIRED");
    expect(slipFailureCode(VALIDATION)).toBe("VALIDATION_ERROR");
  });

  test("is null when the message was already translated", () => {
    expect(slipFailureCode(QUOTA)).toBeNull();
    expect(slipFailureCode([])).toBeNull();
  });
});

describe("slipFailureAdvice", () => {
  test("tells the shop to renew when the package expired", () => {
    expect(slipFailureAdvice(EXPIRED)).toContain("ต่ออายุ");
  });

  test("tells the shop to buy quota when the quota is gone", () => {
    expect(slipFailureAdvice(QUOTA)).toContain("โควตา");
  });

  test("is null for a failure it does not recognise", () => {
    expect(slipFailureAdvice(VALIDATION)).toBeNull();
  });
});

describe("formatTelegramSlipCheckDown", () => {
  const text = formatTelegramSlipCheckDown({
    reasons: EXPIRED,
    failedLast24h: 13,
    bookingId: "7f1c2d3e-0000-4000-8000-000000000001",
  });

  test("says plainly that automatic checking is off, not that a slip failed", () => {
    expect(text).toContain("ระบบตรวจสลิปอัตโนมัติใช้งานไม่ได้");
  });

  test("carries the provider's reason and what to do about it", () => {
    expect(text).toContain("SERVICE_EXPIRED");
    expect(text).toContain("ต่ออายุ");
  });

  test("says how many slips it has already hit, so the size is obvious", () => {
    expect(text).toContain("13");
  });

  test("warns that bookings now wait for an admin", () => {
    expect(text).toContain("ยืนยันเอง");
  });

  test("escapes anything the provider put in the message", () => {
    const hostile = formatTelegramSlipCheckDown({ reasons: ["<b>พัง</b> & หมดอายุ"], failedLast24h: 1 });
    expect(hostile).toContain("&lt;b&gt;");
    expect(hostile).toContain("&amp;");
  });

  test("leaves the count out when it is not known", () => {
    const text = formatTelegramSlipCheckDown({ reasons: QUOTA });
    expect(text).toContain("โควตา");
  });
});
