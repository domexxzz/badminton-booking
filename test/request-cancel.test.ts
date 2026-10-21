import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  createClient: vi.fn(),
  notify: vi.fn(),
  revalidate: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("../src/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("../src/lib/line/notify-shop", () => ({
  notifyBookingRequest: mocks.notify,
  notifyRequestResolvedToCustomer: vi.fn(),
}));

import { requestCancel } from "../src/app/request-actions";

const id = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createClient.mockResolvedValue({ rpc: mocks.rpc });
  mocks.rpc.mockResolvedValue({ error: null });
});

describe("requestCancel", () => {
  test("passes an account-only request to the database without a QR", async () => {
    expect(await requestCancel(id, null, "ติดธุระ", "  Test Bank\n0000000000\nTest Customer  ")).toEqual({ ok: true, data: null });
    expect(mocks.rpc).toHaveBeenCalledWith("request_cancel", {
      p_booking_id: id, p_qr_path: null, p_reason: "ติดธุระ",
      p_refund_account: "Test Bank\n0000000000\nTest Customer",
    });
    expect(mocks.notify).toHaveBeenCalledWith(id, "cancel");
  });

  test("keeps QR-only requests working", async () => {
    expect((await requestCancel(id, "user/booking-qr-1.png", "")).ok).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledWith("request_cancel", {
      p_booking_id: id, p_qr_path: "user/booking-qr-1.png", p_reason: null,
    });
  });

  test("uses the old QR signature when account contains only whitespace", async () => {
    await requestCancel(id, "user/booking-qr-1.png", "", " \n ");
    expect(mocks.rpc).toHaveBeenCalledWith("request_cancel", {
      p_booking_id: id, p_qr_path: "user/booking-qr-1.png", p_reason: null,
    });
  });

  test("explains missing database support without dropping account details or cancelling", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.rpc.mockResolvedValue({ error: { code: "PGRST202", message: "Function not found" } });
    try {
      const result = await requestCancel(id, "user/booking-qr-1.png", "", "0000000000");
      expect(result).toEqual({ ok: false, error: expect.stringContaining("ระบบรับบัญชีคืนเงินยังไม่พร้อมใช้งาน") });
      expect(mocks.rpc).toHaveBeenCalledTimes(1);
      expect(mocks.notify).not.toHaveBeenCalled();
      expect(mocks.revalidate).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
    }
  });

  test("sends both details when both are supplied", async () => {
    await requestCancel(id, "user/booking-qr-1.png", "", "0000000000");
    expect(mocks.rpc).toHaveBeenCalledWith("request_cancel", expect.objectContaining({ p_refund_account: "0000000000", p_qr_path: "user/booking-qr-1.png" }));
  });

  test("rejects missing or whitespace-only refund details before calling the database", async () => {
    expect((await requestCancel(id, null, "", " \n\t ")).ok).toBe(false);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  test("rejects oversized account details", async () => {
    expect((await requestCancel(id, null, "", "1".repeat(301))).ok).toBe(false);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  test("does not notify a cancellation when the database refuses it", async () => {
    mocks.rpc.mockResolvedValue({ error: { message: "CANCEL_DEADLINE_PASSED" } });
    expect((await requestCancel(id, null, "", "0000000000")).ok).toBe(false);
    expect(mocks.notify).not.toHaveBeenCalled();
    expect(mocks.revalidate).not.toHaveBeenCalled();
  });
});
