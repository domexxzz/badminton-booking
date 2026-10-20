import { CHANNEL_LABEL, formatBaht, formatSlot } from "@/lib/format";

export type BookingSummary = {
  court: string;
  startsAt: string;
  endsAt: string;
  amount: number;
  customer: string;
  channel: string;
  userId?: string;
};

export type ShopEvent = "confirmed" | "needs_review" | "unmatched" | "request";

const MAX_NAME = 40;

/**
 * Customer names are typed by customers but sent from the shop's official
 * account, so strip anything LINE would turn into a link and keep it short.
 */
export function sanitizeName(name: string): string {
  const cleaned = name
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\S*(https?:\/\/|www\.)\S*/gi, "[ลิงก์]")
    .replace(/\S+\.\S+/g, "[ลิงก์]")
    .trim();
  return cleaned.length > MAX_NAME ? `${cleaned.slice(0, MAX_NAME)}…` : cleaned || "ลูกค้า";
}

const describe = (b: BookingSummary) =>
  `${b.court} · ${formatSlot(b.startsAt, b.endsAt)}\n${sanitizeName(b.customer)} (${CHANNEL_LABEL[b.channel] ?? b.channel}) · ${formatBaht(b.amount)}`;

export const bookingConfirmedText = (b: BookingSummary) => `✅ ยืนยันการจองอัตโนมัติ\n${describe(b)}`;

export const newBookingAlertText = (b: BookingSummary) =>
  `⚡ มีการจองคิวใหม่ (รอชำระเงิน)\n${describe(b)}\n⏳ ล็อกคิวรอชำระเงิน 5 นาที`;

// Links in LINE messages follow wherever the site is hosted (NEXT_PUBLIC_SITE_URL).
const siteUrl = () => (process.env.NEXT_PUBLIC_SITE_URL ?? "https://badminton-booking-ihw1.onrender.com").replace(/\/$/, "");

export const customerBookingConfirmedText = (b: BookingSummary, bookingId: string) =>
  `🎉 การจองสนามแบดมินตันของคุณได้รับการยืนยันแล้ว!\n${b.court} · ${formatSlot(b.startsAt, b.endsAt)}\nยอดชำระ: ${formatBaht(b.amount)} (เรียบร้อย)\nดูรายละเอียดคิว: ${siteUrl()}/bookings/${bookingId}`;

export const customerSlipSubmittedText = (b: BookingSummary) =>
  `🧾 ได้รับสลิปของคุณแล้ว\n${b.court} · ${formatSlot(b.startsAt, b.endsAt)}\nระบบกำลังส่งให้แอดมินตรวจสอบคิว ขอบคุณครับ`;

export const customerSlipRejectedText = (b: BookingSummary, note: string) =>
  `⚠️ สลิปของคุณไม่ผ่านการตรวจสอบ\n${b.court} · ${formatSlot(b.startsAt, b.endsAt)}\nเหตุผล: ${note || "ยอดเงินหรือข้อมูลไม่ตรง"}\nกรุณาแนบสลิปใหม่อีกครั้งครับ`;

export const customerRequestResolvedText = (
  b: BookingSummary,
  kind: "reschedule" | "cancel",
  approve: boolean,
  note: string,
) => {
  if (kind === "cancel") {
    return approve
      ? `✅ คำขอยกเลิกและคืนเงินของคุณได้รับการอนุมัติแล้ว\n${b.court}\nหมายเหตุ: ${note || "โอนเงินคืนเรียบร้อย"}`
      : `❌ คำขอยกเลิกของคุณไม่ได้รับการอนุมัติ\nเหตุผล: ${note || "-"}`;
  }
  return approve
    ? `✅ คำขอเลื่อนเวลาการจองของคุณได้รับการอนุมัติแล้ว\n${b.court} · เวลาใหม่: ${formatSlot(b.startsAt, b.endsAt)}`
    : `❌ คำขอเลื่อนเวลาของคุณไม่ได้รับการอนุมัติ\nเหตุผล: ${note || "-"}`;
};

export const slipNeedsReviewText = (b: BookingSummary, reasons: string[]) =>
  [`🧾 มีสลิปรอตรวจ`, describe(b), ...reasons.map((r) => `• ${r}`), `ตรวจที่หน้าแอดมิน`].join("\n");

export const unmatchedTransferText = (amount: number | null) =>
  `⚠️ มีเงินเข้า ${amount === null ? "(อ่านยอดไม่ได้)" : formatBaht(amount)}\nเทียบกับสลิปที่หน้าแอดมิน หัวข้อ "เงินเข้า"`;

