import { CHANNEL_LABEL, formatBaht, formatSlot } from "@/lib/format";

export type BookingSummary = {
  court: string;
  startsAt: string;
  endsAt: string;
  amount: number;
  customer: string;
  channel: string;
};

export type ShopEvent = "confirmed" | "needs_review" | "unmatched";

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

export const slipNeedsReviewText = (b: BookingSummary, reasons: string[]) =>
  [`🧾 มีสลิปรอตรวจ`, describe(b), ...reasons.map((r) => `• ${r}`), `ตรวจที่หน้าแอดมิน`].join("\n");

export const unmatchedTransferText = (amount: number | null) =>
  `⚠️ มีเงินเข้า ${amount === null ? "(อ่านยอดไม่ได้)" : formatBaht(amount)}\nเทียบกับสลิปที่หน้าแอดมิน หัวข้อ "เงินเข้า"`;
