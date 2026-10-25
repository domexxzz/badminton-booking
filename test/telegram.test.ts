import { describe, expect, test, vi } from "vitest";
import { getTelegramConfig, sendTelegramMessage, sendTelegramPhoto } from "../src/lib/telegram/client";
import {
  escapeHtml,
  formatTelegramCancelledBooking,
  formatTelegramCancelRequest,
  formatTelegramNewBooking,
  formatTelegramRescheduleRequest,
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
      partyChatId: "-1004354078243",
      partyThreadId: 7,
    });
    const config = getTelegramConfig({
      TELEGRAM_BOT_TOKEN: "custom_token",
      TELEGRAM_CHAT_ID: "-1001234567890",
      TELEGRAM_PARTY_THREAD_ID: "7",
    });
    expect(config).toEqual({
      botToken: "custom_token",
      chatId: "-1001234567890",
      partyChatId: "-1001234567890",
      partyThreadId: 7,
    });
  });

  test("sendTelegramMessage posts JSON to telegram sendMessage endpoint with optional thread_id", async () => {
    const fetchImpl = jsonResponse(200, { ok: true, result: { message_id: 123 } });
    process.env.TELEGRAM_CHAT_ID = "-100999";

    const ok = await sendTelegramMessage("สวัสดี", { parseMode: "HTML", messageThreadId: 7 }, fetchImpl);
    expect(ok).toBe(true);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("https://api.telegram.org/bot");
    expect(url).toContain("/sendMessage");
    expect(init.method).toBe("POST");

    const body = JSON.parse(init.body as string);
    expect(body.chat_id).toBe("-100999");
    expect(body.message_thread_id).toBe(7);
    expect(body.text).toBe("สวัสดี");
    expect(body.parse_mode).toBe("HTML");
  });

  test("sendTelegramPhoto posts FormData to telegram sendPhoto endpoint with optional thread_id", async () => {
    const fetchImpl = jsonResponse(200, { ok: true, result: { message_id: 124 } });
    process.env.TELEGRAM_CHAT_ID = "-100999";

    const dummyBlob = new Blob(["image data"], { type: "image/jpeg" });
    const ok = await sendTelegramPhoto(dummyBlob, "คำบรรยาย", { parseMode: "HTML", messageThreadId: 7 }, fetchImpl);
    expect(ok).toBe(true);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/sendPhoto");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    const formData = init.body as FormData;
    expect(formData.get("message_thread_id")).toBe("7");
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

  test("shows the slip transfer time in Bangkok time, not UTC", () => {
    const text = formatTelegramSlipReport({
      summary: SAMPLE_SUMMARY,
      bookingId: "b-3",
      verifyStatus: "verified",
      slipDate: "2026-10-25T13:50:26+00:00",
    });

    expect(text).toMatch(/เวลาโอนตามสลิป:<\/b> \S+ 25 ต\.ค\. · 20:50:26 น\./);
    expect(text).not.toContain("+00:00");
  });

  test("keeps an unparseable slip time as written", () => {
    const text = formatTelegramSlipReport({
      summary: SAMPLE_SUMMARY,
      bookingId: "b-4",
      verifyStatus: "verified",
      slipDate: "25 ต.ค. 2569 18:30 น.",
    });

    expect(text).toContain("เวลาโอนตามสลิป:</b> 25 ต.ค. 2569 18:30 น.");
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

  test("formats party/team room booking alert with host and mode", () => {
    const text = formatTelegramNewBooking(
      {
        ...SAMPLE_SUMMARY,
        party: {
          id: "party-xyz",
          title: "ก๊วนมือใหม่ตีขำๆ <บุฟเฟต์>",
          mode: "doubles",
          hostName: "โค้ชโดม",
        },
      },
      "booking-456",
    );

    expect(text).toContain("มีการเปิดห้องก๊วน/ทีมใหม่! (รอชำระเงิน)");
    expect(text).toContain("ก๊วนมือใหม่ตีขำๆ &lt;บุฟเฟต์&gt;");
    expect(text).toContain("โค้ชโดม (ประเภทคู่ (Doubles))");
    expect(text).toContain("/queue/party-xyz");
  });

  test("formats multi-court booking badge when multiple courts are booked together", () => {
    const text = formatTelegramNewBooking(
      {
        ...SAMPLE_SUMMARY,
        court: "สนาม 1, สนาม 2",
        multiCourtCount: 2,
        amount: 600,
      },
      "booking-789",
    );

    expect(text).toContain("สนาม 1, สนาม 2 <i>(เหมา 2 สนาม)</i>");
    expect(text).toContain("฿600");
  });

  test("formats cancel & refund request for regular booking with reason and account", () => {
    const text = formatTelegramCancelRequest({
      summary: SAMPLE_SUMMARY,
      bookingId: "b-cancel-1",
      refundAmount: 300,
      reason: "ติดธุระด่วน",
      refundAccount: "KBANK 012-3-45678-9",
    });

    expect(text).toContain("มีคำขอยกเลิกการจอง (รอโอนเงินคืน)");
    expect(text).toContain("สนาม 1");
    expect(text).toContain("฿300");
    expect(text).toContain("ติดธุระด่วน");
    expect(text).toContain("KBANK 012-3-45678-9");
    expect(text).toContain("/admin/requests");
  });

  test("formats cancel & refund request for party/team room", () => {
    const text = formatTelegramCancelRequest({
      summary: {
        ...SAMPLE_SUMMARY,
        party: {
          id: "p-cancel-1",
          title: "ก๊วนตีวันเสาร์",
          mode: "doubles",
          hostName: "หัวหน้าสมชาย",
        },
      },
      bookingId: "b-cancel-party",
      refundAmount: 500,
      reason: "สมาชิกไม่ครบ",
    });

    expect(text).toContain("มีคำขอยกเลิกห้องก๊วน/ทีม (รอโอนเงินคืน)");
    expect(text).toContain("ก๊วนตีวันเสาร์");
    expect(text).toContain("หัวหน้าสมชาย");
    expect(text).toContain("฿500");
    expect(text).toContain("สมาชิกไม่ครบ");
  });

  test("formats reschedule request with new court and slot", () => {
    const text = formatTelegramRescheduleRequest({
      summary: SAMPLE_SUMMARY,
      bookingId: "b-resched-1",
      newCourtName: "สนาม 3",
      newStartsAt: "2026-10-26T12:00:00.000Z",
      newEndsAt: "2026-10-26T14:00:00.000Z",
      reason: "ขอเปลี่ยนวัน",
    });

    expect(text).toContain("มีคำขอเลื่อนเวลาการจอง");
    expect(text).toContain("สนามเดิม:</b> สนาม 1");
    expect(text).toContain("สนาม 3");
    expect(text).toContain("ขอเปลี่ยนวัน");
    expect(text).toContain("/admin/requests");
  });

  test("formats direct booking cancellation alert", () => {
    const text = formatTelegramCancelledBooking(SAMPLE_SUMMARY, "b-direct-1");
    expect(text).toContain("ลูกค้ายกเลิกการจองคิว (ปลดล็อกสนามแล้ว)");
    expect(text).toContain("สนาม 1");
    expect(text).toContain("฿300");
    expect(text).toContain("ปลดล็อกสนามว่างให้ลูกค้าท่านอื่นจองต่อได้");
  });

  test("formats direct cancellation for party booking", () => {
    const text = formatTelegramCancelledBooking(
      {
        ...SAMPLE_SUMMARY,
        party: {
          id: "party-direct-cancel",
          title: "ก๊วนแบดยามเย็น",
          mode: "singles",
          hostName: "นายเอ",
        },
      },
      "b-party-cancel-direct",
    );
    expect(text).toContain("ยกเลิกการเปิดห้องก๊วน (ปลดล็อกสนามแล้ว)");
    expect(text).toContain("ก๊วนแบดยามเย็น");
    expect(text).toContain("นายเอ");
  });
});

