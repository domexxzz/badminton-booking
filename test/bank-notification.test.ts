import { describe, expect, test } from "vitest";
import { parseBankNotification } from "../src/lib/bank/notification";

// Illustrative messages in the styles Thai bank apps use. Real formats vary by
// bank and app version; add the shop's real notification text here once known.
describe("parseBankNotification: reading amounts", () => {
  test("reads an incoming transfer and ignores the balance", () => {
    expect(parseBankNotification("เงินเข้า\nบัญชี x1234 รับโอน 300.37 บาท คงเหลือ 12,345.67 บาท")).toEqual({
      direction: "in",
      amount: 300.37,
    });
  });

  test("reads a baht sign and thousands separator, dropping the sender name", () => {
    expect(parseBankNotification("มีเงินโอนเข้า ฿1,200.15 จาก นาย สมชาย ใ")).toEqual({ direction: "in", amount: 1200.15 });
  });

  test("reads English notifications", () => {
    expect(parseBankNotification("Money in: THB 450.08 received to x-1234. Available balance THB 9,000.00").amount).toBe(450.08);
  });

  test("ignores clock times, dates and fees around the amount", () => {
    expect(parseBankNotification("เงินเข้า 300.37 บาท 13.10.26 เวลา 18.05 น. ค่าธรรมเนียม 0.00 บาท").amount).toBe(300.37);
  });

  test("keeps an amount followed by a full stop", () => {
    expect(parseBankNotification("เงินเข้า 1.00. ขอบคุณ").amount).toBe(1);
  });
});

describe("parseBankNotification: failing closed", () => {
  test("no 2-decimal amount", () => {
    expect(parseBankNotification("เงินเข้า 300 บาท")).toEqual({ direction: "in", amount: null });
  });

  test("amount not directly after the keyword", () => {
    expect(parseBankNotification("฿300.37 เงินเข้าบัญชี x1234")).toEqual({ direction: "in", amount: null });
  });

  test("absurdly long numbers", () => {
    expect(parseBankNotification("เงินเข้า 99999999999999999999.99 บาท").amount).toBeNull();
  });

  test("outgoing transfers", () => {
    expect(parseBankNotification("โอนเงินสำเร็จ 300.37 บาท ไปยัง x5678")).toEqual({ direction: "out", amount: null });
    expect(parseBankNotification("เงินออก 120.00 บาท")).toEqual({ direction: "out", amount: null });
  });

  test("mixed signals", () => {
    expect(parseBankNotification("เงินเข้า 300.37 / เงินออก 300.37").direction).toBe("unknown");
  });

  test("unrelated notifications", () => {
    expect(parseBankNotification("โปรโมชันพิเศษ ลด 50.00 บาท")).toEqual({ direction: "unknown", amount: null });
  });
});

// A customer holding a ฿300.37 booking sends ฿1.00 and hides "300.37" in text
// they control. None of these may come out as 300.37.
describe("parseBankNotification: sender-controlled text", () => {
  const attacks = [
    "฿1.00 เงินเข้าบัญชี x1234 จาก นาย A บันทึก: 300.37 บาท",
    "รับโอนจาก ร้าน 300.37 จำนวน 1.00 บาท",
    "เงินเข้า 1.00. memo 300.37",
    "เงินเข้าบัญชี x1234 1.00 บาท\nเงินเข้า 300.37",
    "เงินเข้า 1.00 บาท\nเงินเข้า 300.37",
    "เงินเข้า จาก เงินเข้า 300.37 คงเหลือ 1.00 บาท",
    "เงินเข้า 1.00 บาท note: received 300.37",
    "นาย A รับเงิน 300.37 จาก เงินเข้า 1.00 บาท",
    "เงินเข้า บัญชี x1234 โดย รับเงิน 300.37 note ยอด 1.00 บาท",
    "เงินเข้า รับเงิน 300.37 คงเหลือ 1.00 บาท",
    "เงินเข้า รับเงิน 300.37 ค่าธรรมเนียม 1.00 บาท",
    "เงินเข้า รับเงิน 300.37 เวลา 1.00 บาท",
  ];

  test.each(attacks)("%s", (text) => {
    expect(parseBankNotification(text).amount).not.toBe(300.37);
  });
});
