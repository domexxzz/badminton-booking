import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  createClient: vi.fn(),
  getSessionUser: vi.fn(),
  revalidate: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("../src/lib/supabase/server", () => ({
  createClient: mocks.createClient,
  getSessionUser: mocks.getSessionUser,
}));
vi.mock("../src/lib/supabase/service", () => ({ getServiceClient: () => null }));
vi.mock("../src/lib/line/notify-shop", () => ({
  notifyAfterSlip: vi.fn(),
  notifyNewBooking: vi.fn(),
  notifyPaymentReviewed: vi.fn(),
}));
vi.mock("../src/lib/slip/verify-booking", () => ({
  isSlipVerificationEnabled: () => false,
  verifyLatestSlip: vi.fn(),
}));

import { adminCreateBooking, reviewPayment } from "../src/app/actions";
import { resolveRequest } from "../src/app/request-actions";

const id = "11111111-1111-1111-1111-111111111111";
const requestId = "22222222-2222-2222-2222-222222222222";

const adminInput = {
  courtId: 1,
  date: "2026-11-01",
  hour: 18,
  hours: 1,
  channel: "phone" as const,
  name: "คุณลูกค้า",
  phone: "0812345678",
  note: "",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createClient.mockResolvedValue({ rpc: mocks.rpc, from: vi.fn() });
  mocks.rpc.mockReturnValue({ single: () => Promise.resolve({ data: { id }, error: null }) });
});

// A field that is not a string used to reach `.length` / `.slice()` and throw a
// TypeError, which Next reports to the customer as a blank 500 instead of a Thai
// message. Every one of these must be refused before the database is touched.
describe("server actions refuse input that is not text", () => {
  test("adminCreateBooking: a missing phone or note is refused, not a crash", async () => {
    for (const bad of [{ phone: undefined }, { note: undefined }, { phone: null }, { note: 5 }]) {
      const result = await adminCreateBooking({ ...adminInput, ...bad } as never);
      expect(result).toEqual({ ok: false, error: "ข้อมูลการจองไม่ครบหรือไม่ถูกต้อง" });
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  test("adminCreateBooking: a valid booking still reaches the database", async () => {
    expect(await adminCreateBooking(adminInput)).toEqual({ ok: true, data: { id } });
    expect(mocks.rpc).toHaveBeenCalledWith("admin_create_booking", expect.objectContaining({ p_court_id: 1 }));
  });

  test("reviewPayment: a note that is not text is refused", async () => {
    expect(await reviewPayment(id, true, undefined as never)).toEqual({ ok: false, error: "ข้อมูลไม่ถูกต้อง" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  test("resolveRequest: a refund slip path that is not text is refused", async () => {
    const result = await resolveRequest({
      requestId,
      bookingId: id,
      approve: true,
      note: "",
      refundSlipPath: 7 as never,
    });
    expect(result).toEqual({ ok: false, error: "ข้อมูลไม่ถูกต้อง" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
