import { describe, expect, test } from "vitest";
import { planAdminSlipUpload } from "../src/lib/admin-slip";

describe("planAdminSlipUpload", () => {
  test("keeps a booking the admin already confirmed out of the review queue", () => {
    expect(planAdminSlipUpload("confirmed")).toEqual({ allowed: true, keepConfirmed: true });
  });

  test("sends an unpaid booking to review", () => {
    expect(planAdminSlipUpload("pending_payment")).toEqual({ allowed: true, keepConfirmed: false });
  });

  test("refuses a booking that already has a slip waiting", () => {
    expect(planAdminSlipUpload("awaiting_review")).toEqual({
      allowed: false,
      error: "การจองนี้มีสลิปรอตรวจอยู่แล้ว",
    });
  });

  test("refuses a cancelled or expired booking", () => {
    expect(planAdminSlipUpload("cancelled").allowed).toBe(false);
    expect(planAdminSlipUpload("expired").allowed).toBe(false);
  });

  test("refuses when the status was never read, instead of guessing", () => {
    // The bookings row must actually select "status"; without it nothing is allowed.
    expect(planAdminSlipUpload(undefined).allowed).toBe(false);
    expect(planAdminSlipUpload(null).allowed).toBe(false);
  });
});
