import { describe, expect, test } from "vitest";
import { BBL_MERCHANT_INFO } from "../src/lib/promptpay";
import { buildCheckRecord, receiverFromEnv } from "../src/lib/slip/check-record";
import type { Expectation } from "../src/lib/slip/evaluate";
import type { ProviderResult, SlipFacts } from "../src/lib/slip/types";

const ok = (overrides: Partial<SlipFacts> = {}, receiver: Partial<SlipFacts["receiver"]> = {}): ProviderResult => ({
  kind: "ok",
  raw: { from: "test" },
  slip: {
    transRef: "68370160657749I376388B35",
    amount: 300,
    date: "2026-10-20T18:05:00+07:00",
    sender: { name: "นาย ลูกค้า ด" },
    ...overrides,
    receiver: {
      names: ["นาย สมชาย ใ"],
      bankAccount: null,
      proxyType: "MSISDN",
      proxyAccount: "xxx-xxx-5678",
      ...receiver,
    },
  },
});

const exp = (overrides: Partial<Expectation> = {}): Expectation => ({
  amountBaht: 300,
  bookingCreatedAt: "2026-10-20T18:00:00+07:00",
  now: new Date("2026-10-20T18:06:00+07:00"),
  promptPayId: "0812345678",
  bankAccount: null,
  billerId: null,
  receiverNames: ["สมชาย ใจดี"],
  ...overrides,
});

describe("buildCheckRecord", () => {
  test("verifies a slip with the right amount, receiver and time", () => {
    const record = buildCheckRecord(ok(), exp());
    expect(record.status).toBe("verified");
    expect(record.transRef).toBe("68370160657749I376388B35");
    expect(record.amount).toBe(300);
    expect(record.reasons).toContain("ชื่อผู้โอน: นาย ลูกค้า ด");
    expect(record.reasons).toContain("ชื่อผู้รับ: นาย สมชาย ใ");
  });

  test("does not verify a right-amount slip paid to another account", () => {
    const record = buildCheckRecord(ok({}, { names: ["นาย คนอื่น ข"], proxyAccount: "xxx-xxx-9999" }), exp());
    expect(record.status).toBe("mismatch");
    expect(record.reasons).toContain("บัญชีผู้รับไม่ตรงกับร้าน (xxx-xxx-9999)");
    expect(record.reasons).toContain("ชื่อผู้รับไม่ตรงกับร้าน (นาย คนอื่น ข)");
  });

  test("does not verify a right-amount slip from before the booking", () => {
    const record = buildCheckRecord(ok({ date: "2026-10-19T10:00:00+07:00" }), exp());
    expect(record.status).toBe("mismatch");
    expect(record.reasons).toContain("สลิปโอนก่อนเวลาจอง อาจเป็นสลิปเก่า");
  });

  test("does not verify when the receiver is not configured", () => {
    const record = buildCheckRecord(ok(), exp({ receiverNames: [] }));
    expect(record.status).toBe("mismatch");
  });

  test("flags a wrong amount", () => {
    expect(buildCheckRecord(ok({ amount: 150 }), exp()).status).toBe("mismatch");
  });

  test("passes provider failures through unchanged", () => {
    expect(buildCheckRecord({ kind: "unreadable", message: "อ่านไม่ได้" }, exp())).toEqual({
      status: "unreadable",
      reasons: ["อ่านไม่ได้"],
    });
  });
});

describe("receiverFromEnv", () => {
  test("reads the PromptPay ID, bank account, biller ID and comma-separated names", () => {
    expect(
      receiverFromEnv({
        PROMPTPAY_ID: "0812345678",
        SLIP_RECEIVER_BANK_ACCOUNT: "123-4-56789-0",
        SLIP_RECEIVER_BILLER_ID: "010753600037406",
        SLIP_RECEIVER_NAME: " สมชาย ใจดี , Somchai Jaidee ,",
      }),
    ).toEqual({
      promptPayId: "0812345678",
      bankAccount: "123-4-56789-0",
      billerId: "010753600037406",
      receiverNames: ["สมชาย ใจดี", "Somchai Jaidee"],
    });
  });

  test("treats missing or empty values as not configured", () => {
    const { promptPayId, bankAccount, receiverNames } = receiverFromEnv({ PROMPTPAY_ID: "" });
    expect({ promptPayId, bankAccount, receiverNames }).toEqual({
      promptPayId: null,
      bankAccount: null,
      receiverNames: [],
    });
  });

  test("falls back to the biller ID of the shop's own merchant QR", () => {
    expect(receiverFromEnv({}).billerId).toBe(BBL_MERCHANT_INFO.billerId);
    expect(receiverFromEnv({ SLIP_RECEIVER_BILLER_ID: "999" }).billerId).toBe("999");
  });
});
