import { describe, expect, test } from "vitest";
import { crc16, parseTarget, promptPayPayload } from "../src/lib/promptpay";

describe("crc16", () => {
  test("matches the CRC-16/CCITT-FALSE check value", () => {
    expect(crc16("123456789")).toBe("29B1");
  });
});

describe("parseTarget", () => {
  test("converts a Thai mobile number to 0066 form padded to 13 digits", () => {
    expect(parseTarget("081-234-5678")).toEqual({ tag: "01", value: "0066812345678" });
  });

  test("treats 13 digits as a national ID", () => {
    expect(parseTarget("1234567890123")).toEqual({ tag: "02", value: "1234567890123" });
  });

  test("treats 15 digits as an e-wallet ID", () => {
    expect(parseTarget("123456789012345")).toEqual({ tag: "03", value: "123456789012345" });
  });

  test("rejects anything else", () => {
    expect(() => parseTarget("12345")).toThrow();
  });
});

describe("promptPayPayload", () => {
  test("builds a one-time payload with amount and a valid CRC", () => {
    const payload = promptPayPayload("0812345678", 300);

    expect(payload).toBe(
      "000201" +
        "010212" +
        "29370016A000000677010111011300668123456785303764" +
        "5406300.00" +
        "5802TH" +
        "6304" +
        crc16(payload.slice(0, -4)),
    );
  });

  test("omits the amount for a reusable payload", () => {
    const payload = promptPayPayload("0812345678");
    expect(payload).toContain("010211");
    expect(payload).not.toContain("5406");
  });

  test("rejects non-positive amounts", () => {
    expect(() => promptPayPayload("0812345678", 0)).toThrow();
    expect(() => promptPayPayload("0812345678", Number.NaN)).toThrow();
  });

  test("accepts Bangkok Bank Merchant Pro EMVCo payload and injects dynamic amount", () => {
    const bblPayload =
      "00020101021130820016A000000677010112011501075360003740602150060000010772720320261018I700000000000053037645802TH5907akkanay62240720BED4256284C54781AC086304C8A7";

    const withAmount = promptPayPayload(bblPayload, 150);
    expect(withAmount).toContain("010212"); // Dynamic QR
    expect(withAmount).toContain("5406150.00"); // Amount tag 54
    expect(withAmount).toContain("5907akkanay");
    expect(withAmount.endsWith(crc16(withAmount.slice(0, -4)))).toBe(true);

    const withoutAmount = promptPayPayload(bblPayload);
    expect(withoutAmount).toBe(bblPayload);
  });
});

