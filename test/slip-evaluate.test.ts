import { describe, expect, test } from "vitest";
import {
  evaluateSlip,
  maskedMatches,
  nameMatches,
  promptPayVariants,
  type Expectation,
} from "../src/lib/slip/evaluate";
import type { SlipFacts } from "../src/lib/slip/types";

const slip = (overrides: Partial<SlipFacts> = {}, receiver: Partial<SlipFacts["receiver"]> = {}): SlipFacts => ({
  transRef: "68370160657749I376388B35",
  amount: 300.37,
  date: "2026-10-20T18:05:00+07:00",
  ...overrides,
  receiver: {
    names: ["นาย สมชาย ใ", "MR. SOMCHAI J"],
    bankAccount: null,
    proxyType: "MSISDN",
    proxyAccount: "xxx-xxx-5678",
    ...receiver,
  },
});

const exp = (overrides: Partial<Expectation> = {}): Expectation => ({
  amountBaht: 300.37,
  bookingCreatedAt: "2026-10-20T18:00:00+07:00",
  now: new Date("2026-10-20T18:06:00+07:00"),
  promptPayId: "0812345678",
  bankAccount: null,
  receiverNames: ["สมชาย ใจดี"],
  ...overrides,
});

describe("maskedMatches", () => {
  test("compares position by position", () => {
    expect(maskedMatches("xxx-x-x5678-x", "987-6-05678-1")).toBe(true);
    expect(maskedMatches("xxx-x-x5679-x", "987-6-05678-1")).toBe(false);
  });

  test("rejects masks of a different length instead of guessing", () => {
    expect(maskedMatches("08xxxxxxxx78", "0812345678")).toBe(false);
  });

  test("requires at least 4 visible digits", () => {
    expect(maskedMatches("xxx-xxx-x678", "0812345678")).toBe(false);
    expect(maskedMatches("xxx-xxx-5678", "0812345678")).toBe(true);
  });

  test("treats * and X as mask characters", () => {
    expect(maskedMatches("***-***-5678", "0812345678")).toBe(true);
    expect(maskedMatches("XXX-XXX-5678", "0812345678")).toBe(true);
  });
});

describe("promptPayVariants", () => {
  test("covers local and international forms of a mobile number", () => {
    expect(promptPayVariants("081-234-5678")).toEqual({
      type: "MSISDN",
      values: ["0812345678", "66812345678", "0066812345678"],
    });
  });

  test("maps 13 digits to NATID and 15 to EWALLETID", () => {
    expect(promptPayVariants("1234567890123").type).toBe("NATID");
    expect(promptPayVariants("123456789012345").type).toBe("EWALLETID");
  });
});

describe("nameMatches", () => {
  test("matches a truncated slip name, ignoring titles and spaces", () => {
    expect(nameMatches("นาย สมชาย ใ", "สมชาย ใจดี")).toBe(true);
    expect(nameMatches("นางสาว สมหญิง", "สมหญิง รักดี")).toBe(true);
    expect(nameMatches("MR. SOMCHAI J", "Somchai Jaidee")).toBe(true);
  });

  test("rejects a different name", () => {
    expect(nameMatches("นาย สมศักดิ์ ม", "สมชาย ใจดี")).toBe(false);
  });

  test("rejects names too short to mean anything", () => {
    expect(nameMatches("นาย ส", "สมชาย ใจดี")).toBe(false);
  });
});

describe("evaluateSlip", () => {
  test("verifies a slip with the right amount, receiver and time", () => {
    expect(evaluateSlip(slip(), exp())).toEqual({ status: "verified", reasons: [] });
  });

  test("accepts the PromptPay proxy in 66 international form", () => {
    expect(evaluateSlip(slip({}, { proxyAccount: "xxxxxxx5678" }), exp()).status).toBe("verified");
  });

  test("falls back to the bank account when the slip has no proxy", () => {
    const result = evaluateSlip(
      slip({}, { proxyType: null, proxyAccount: null, bankAccount: "xxx-x-x5678-x" }),
      exp({ bankAccount: "987-6-05678-1" }),
    );
    expect(result.status).toBe("verified");
  });

  test("flags a wrong amount, including a missing satang suffix", () => {
    expect(evaluateSlip(slip({ amount: 250 }), exp()).reasons[0]).toContain("ยอดในสลิป");
    expect(evaluateSlip(slip({ amount: 300 }), exp()).status).toBe("mismatch");
  });

  test("flags matching digits paid to someone with another name", () => {
    const result = evaluateSlip(slip({}, { names: ["นาย สมศักดิ์ ม"] }), exp());
    expect(result.status).toBe("mismatch");
    expect(result.reasons[0]).toContain("ชื่อผู้รับ");
  });

  test("flags a transfer to another account", () => {
    const result = evaluateSlip(slip({}, { proxyAccount: "xxx-xxx-9999" }), exp());
    expect(result.reasons[0]).toContain("บัญชีผู้รับ");
  });

  test("does not trust a proxy of the wrong type", () => {
    expect(evaluateSlip(slip({}, { proxyType: "NATID" }), exp()).status).toBe("mismatch");
  });

  test("flags an old slip from before the booking", () => {
    const result = evaluateSlip(slip({ date: "2026-10-19T12:00:00+07:00" }), exp());
    expect(result.reasons).toContain("สลิปโอนก่อนเวลาจอง อาจเป็นสลิปเก่า");
  });

  test("allows a few minutes of clock skew", () => {
    expect(evaluateSlip(slip({ date: "2026-10-20T17:57:00+07:00" }), exp()).status).toBe("verified");
  });

  test("never verifies when the receiver name is not configured", () => {
    expect(evaluateSlip(slip(), exp({ receiverNames: [] })).status).toBe("mismatch");
    expect(evaluateSlip(slip(), exp({ promptPayId: null })).status).toBe("mismatch");
  });
});
