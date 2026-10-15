import { describe, expect, test } from "vitest";
import { noticeForTransition } from "../src/lib/booking-notice";

describe("noticeForTransition", () => {
  test("shows nothing on first sight or when nothing changed", () => {
    expect(noticeForTransition(null, "confirmed", null)).toBeNull();
    expect(noticeForTransition("awaiting_review", "awaiting_review", null)).toBeNull();
  });

  test("celebrates a confirmation, whether instant or after review", () => {
    expect(noticeForTransition("pending_payment", "confirmed", null)).toBe("confirmed");
    expect(noticeForTransition("awaiting_review", "confirmed", null)).toBe("confirmed");
  });

  test("acknowledges a slip that now waits for the shop", () => {
    expect(noticeForTransition("pending_payment", "awaiting_review", null)).toBe("submitted");
  });

  test("reports a rejected slip with its reason", () => {
    expect(noticeForTransition("awaiting_review", "pending_payment", "ยอดไม่ตรง")).toBe("rejected");
  });

  test("does not call a reopened booking rejected without a reason", () => {
    expect(noticeForTransition("awaiting_review", "pending_payment", null)).toBeNull();
  });

  test("tells the customer when an unpaid hold ran out", () => {
    expect(noticeForTransition("pending_payment", "expired", null)).toBe("expired");
    expect(noticeForTransition("confirmed", "cancelled", null)).toBeNull();
  });
});
