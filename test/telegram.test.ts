import { describe, expect, test, vi } from "vitest";
import { getTelegramConfig, sendTelegramMessage, sendTelegramPhoto } from "../src/lib/telegram/client";
import {
  escapeHtml,
  formatTelegramNewBooking,
  formatTelegramSlipReport,
} from "../src/lib/telegram/messages";
import type { BookingSummary } from "../src/lib/line/messages";

const jsonResponse = (status: number, body: unknown) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

const SAMPLE_SUMMARY: BookingSummary = {
  court: "สนาม 1",
  startsAt: "2026-10-25T11:00:00.000Z",
  endsAt: "2026-10-25T13:00:00.000Z",
  amount: 300,
  customer: "สมชาย & เพื่อน <VIP>",
  channel: "online",
};

describe("Telegram Client", () => {
  test("reads config from env or fallback token", () => {
    expect(getTelegramConfig({})).toEqual({
      botToken: "8827549262:AAGt7aDuc0jF8sYPSrZLZIh4ee5gwcvtAyg",
      chatId: "-1004354078243",
    });
    const config = getTelegramConfig({
      TELEGRAM_BOT_TOKEN: "custom_token",
      TELEGRAM_CHAT_ID: "-1001234567890",
    });
    expect(config).toEqual({
      botToken: "custom_token",
      chatId: "-1001234567890",
    });
  });

  test("sendTelegramMessage posts JSON to telegram sendMessage endpoint", async () => {
    const fetchImpl = jsonResponse(200, { ok: true, result: { message_id: 123 } });
    process.env.TELEGRAM_CHAT_ID = "-100999";

    const ok = await sendTelegramMessage("สวัสดี", { parseMode: "HTML" }, fetchImpl);
    expect(ok).toBe(true);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("https://api.telegram.org/bot");
    expect(url).toContain("/sendMessage");
    expect(init.method).toBe("POST");

    const body = JSON.parse(init.body as string);
    expect(body.chat_id).toBe("-100999");
    expect(body.text).toBe("สวัสดี");
    expect(body.parse_mode).toBe("HTML");
  });

  test("sendTelegramPhoto posts FormData to telegram sendPhoto endpoint", async () => {
    const fetchImpl = jsonResponse(200, { ok: true, result: { message_id: 124 } });
    process.env.TELEGRAM_CHAT_ID = "-100999";

    const dummyBlob = new Blob(["image data"], { type: "image/jpeg" });
    const ok = await sendTelegramPhoto(dummyBlob, "คำบรรยาย", { parseMode: "HTML" }, fetchImpl);
    expect(ok).toBe(true);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/sendPhoto");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
  });
});

describe("Telegram Message Formatting", () => {
  test("escapes HTML special characters safely", () => {
    expect(escapeHtml("A < B & C > D")).toBe("A &lt; B &amp; C &gt; D");
  });

  test("formats new booking alert message", () => {
    const text = formatTelegramNewBooking(SAMPLE_SUMMARY, "booking-123");
    expect(text).toContain("มีการจองคิวใหม่ (รอชำระเงิน)");
    expect(text).toContain("สนาม 1");
    expect(text).toContain("฿300");
    // Escaped HTML
    expect(text).toContain("สมชาย &amp; เพื่อน &lt;VIP&gt;");
  });

  test("formats slip report for verified slip", () => {
    const text = formatTelegramSlipReport({
      summary: SAMPLE_SUMMARY,
      bookingId: "b-1",
      verifyStatus: "verified",
      slipAmount: 300,
      slipDate: "25 ต.ค. 2569 18:30 น.",
      transRef: "20261025TEST1234",
      senderName: "นาย สมชาย ใจดี",
      senderBank: "KBANK",
    });

    expect(text).toContain("รายงานตรวจสลิป: ผ่านอัตโนมัติ (EasySlip)");
    expect(text).toContain("นาย สมชาย ใจดี (KBANK)");
    expect(text).toContain("฿300");
    expect(text).toContain("20261025TEST1234");
  });

  test("formats slip report for unverified / needs review slip with reasons", () => {
    const text = formatTelegramSlipReport({
      summary: SAMPLE_SUMMARY,
      bookingId: "b-2",
      verifyStatus: "needs_review",
      reasons: ["ยอดเงินในสลิป (฿200) ไม่ตรงกับยอดจอง (฿300)", "โอนก่อนเวลาเริ่มจอง"],
      slipAmount: 200,
    });

    expect(text).toContain("รายงานตรวจสลิป: ต้องตรวจสอบ (EasySlip)");
    expect(text).toContain("ยอดเงินในสลิป (฿200) ไม่ตรงกับยอดจอง (฿300)");
    expect(text).toContain("โอนก่อนเวลาเริ่มจอง");
  });
});
