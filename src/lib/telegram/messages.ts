import { CHANNEL_LABEL, formatBaht, formatSlot } from "@/lib/format";
import type { BookingSummary } from "@/lib/line/messages";
import { sanitizeName } from "@/lib/line/messages";

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const siteUrl = () =>
  (process.env.NEXT_PUBLIC_SITE_URL ?? "https://badminton-booking-ihw1.onrender.com").replace(/\/$/, "");

export type TelegramBookingSummary = BookingSummary & {
  party?: {
    id: string;
    title: string;
    mode: string;
    hostName: string;
  } | null;
  multiCourtCount?: number;
};

/** Formats a new booking alert for Telegram admins. */
export function formatTelegramNewBooking(b: TelegramBookingSummary, bookingId: string): string {
  const channel = CHANNEL_LABEL[b.channel] ?? b.channel;
  const customerName = escapeHtml(sanitizeName(b.customer));
  const courtName = escapeHtml(b.court);

  if (b.party) {
    const modeLabel = b.party.mode === "doubles" ? "ประเภทคู่ (Doubles)" : "ประเภทเดี่ยว (Singles)";
    return (
      `🏸 <b>มีการเปิดห้องก๊วน/ทีมใหม่! (รอชำระเงิน)</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `👥 <b>ชื่อก๊วน:</b> ${escapeHtml(b.party.title)}\n` +
      `👑 <b>หัวหน้าก๊วน:</b> ${escapeHtml(b.party.hostName)} (${modeLabel})\n` +
      `📍 <b>สนาม:</b> ${courtName}\n` +
      `⏰ <b>เวลา:</b> ${formatSlot(b.startsAt, b.endsAt)}\n` +
      `💰 <b>ยอดเงิน:</b> ${formatBaht(b.amount)}\n` +
      `📱 <b>ช่องทาง:</b> ${channel}\n` +
      `⏳ <b>สถานะ:</b> ล็อกคิวรอชำระเงิน 5 นาที\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `🔗 <a href="${siteUrl()}/queue/${b.party.id}">ดูกระดานก๊วน / คิวเล่น</a> · <a href="${siteUrl()}/admin">หลังร้าน</a>`
    );
  }

  const multiBadge = b.multiCourtCount && b.multiCourtCount > 1
    ? ` <i>(เหมา ${b.multiCourtCount} สนาม)</i>`
    : "";

  return (
    `⚡ <b>มีการจองคิวใหม่ (รอชำระเงิน)</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `👤 <b>ลูกค้า:</b> ${customerName}\n` +
    `📍 <b>สนาม:</b> ${courtName}${multiBadge}\n` +
    `⏰ <b>เวลา:</b> ${formatSlot(b.startsAt, b.endsAt)}\n` +
    `💰 <b>ยอดเงิน:</b> ${formatBaht(b.amount)}\n` +
    `📱 <b>ช่องทาง:</b> ${channel}\n` +
    `⏳ <b>สถานะ:</b> ล็อกคิวรอชำระเงิน 5 นาที\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🔗 <a href="${siteUrl()}/admin">เปิดดูรายการจองที่ระบบหลังร้าน</a>`
  );
}

export type TelegramSlipReportParams = {
  summary: TelegramBookingSummary;
  bookingId: string;
  verifyStatus: string | null;
  reasons?: string[];
  slipAmount?: number | null;
  slipDate?: string | null;
  transRef?: string | null;
  senderName?: string | null;
  senderBank?: string | null;
};

/** Formats a slip verification report (EasySlip) for Telegram admins. */
export function formatTelegramSlipReport(params: TelegramSlipReportParams): string {
  const { summary, verifyStatus, reasons = [], slipAmount, slipDate, transRef, senderName, senderBank } = params;
  const isVerified = verifyStatus === "verified";
  const customerName = escapeHtml(sanitizeName(summary.customer));
  const courtName = escapeHtml(summary.court);

  const header = isVerified
    ? `✅ <b>รายงานตรวจสลิป: ผ่านอัตโนมัติ (EasySlip)</b>`
    : `⚠️ <b>รายงานตรวจสลิป: ต้องตรวจสอบ (EasySlip)</b>`;

  let text =
    `${header}\n` +
    `━━━━━━━━━━━━━━━━━━━━\n`;

  if (summary.party) {
    text += `👥 <b>ก๊วน/ทีม:</b> ${escapeHtml(summary.party.title)} (โดย ${escapeHtml(summary.party.hostName)})\n`;
  } else {
    text += `👤 <b>ผู้จอง:</b> ${customerName}\n`;
  }

  const multiBadge = summary.multiCourtCount && summary.multiCourtCount > 1
    ? ` <i>(เหมา ${summary.multiCourtCount} สนาม)</i>`
    : "";

  text +=
    `📍 <b>สนาม:</b> ${courtName}${multiBadge}\n` +
    `⏰ <b>รอบเวลา:</b> ${formatSlot(summary.startsAt, summary.endsAt)}\n` +
    `💰 <b>ยอดที่ต้องชำระ:</b> ${formatBaht(summary.amount)}\n`;

  if (slipAmount != null) {
    text += `💵 <b>ยอดโอนตามสลิป:</b> ${formatBaht(slipAmount)}\n`;
  }

  if (senderName || senderBank) {
    const bankPart = senderBank ? ` (${escapeHtml(senderBank)})` : "";
    text += `🏦 <b>ผู้โอน:</b> ${escapeHtml(senderName || "ผู้โอน")}${bankPart}\n`;
  }

  if (slipDate) {
    text += `🕒 <b>เวลาโอนตามสลิป:</b> ${escapeHtml(slipDate)}\n`;
  }

  if (transRef) {
    text += `🧾 <b>รหัสอ้างอิง:</b> <code>${escapeHtml(transRef)}</code>\n`;
  }

  if (!isVerified && reasons.length > 0) {
    text += `\n❌ <b>ข้อสังเกต / สาเหตุ:</b>\n` + reasons.map((r) => `• ${escapeHtml(r)}`).join("\n") + "\n";
  }

  text +=
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🔗 <a href="${siteUrl()}/admin/review">ตรวจสอบหรืออนุมัติสลิปที่หลังร้าน</a>`;

  return text;
}

export type TelegramCancelRequestParams = {
  summary: TelegramBookingSummary;
  bookingId: string;
  refundAmount?: number | null;
  reason?: string | null;
  refundAccount?: string | null;
};

/** Formats a cancel & refund request for Telegram admins. */
export function formatTelegramCancelRequest(params: TelegramCancelRequestParams): string {
  const { summary, refundAmount, reason, refundAccount } = params;
  const customerName = escapeHtml(sanitizeName(summary.customer));
  const courtName = escapeHtml(summary.court);
  const amountToRefund = refundAmount != null ? refundAmount : summary.amount;

  const multiBadge = summary.multiCourtCount && summary.multiCourtCount > 1
    ? ` <i>(เหมา ${summary.multiCourtCount} สนาม)</i>`
    : "";

  let text = "";
  if (summary.party) {
    text +=
      `🏸 <b>มีคำขอยกเลิกห้องก๊วน/ทีม (รอโอนเงินคืน)</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `👥 <b>ชื่อก๊วน:</b> ${escapeHtml(summary.party.title)} (โดย ${escapeHtml(summary.party.hostName)})\n`;
  } else {
    text +=
      `❌ <b>มีคำขอยกเลิกการจอง (รอโอนเงินคืน)</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `👤 <b>ผู้จอง:</b> ${customerName}\n`;
  }

  text +=
    `📍 <b>สนาม:</b> ${courtName}${multiBadge}\n` +
    `⏰ <b>รอบเวลาที่จอง:</b> ${formatSlot(summary.startsAt, summary.endsAt)}\n` +
    `💸 <b>ยอดเงินที่ต้องโอนคืน:</b> ${formatBaht(amountToRefund)}\n`;

  if (reason) {
    text += `📝 <b>เหตุผล:</b> ${escapeHtml(reason)}\n`;
  }

  if (refundAccount) {
    text += `🏦 <b>บัญชีรับเงินคืน:</b> ${escapeHtml(refundAccount)}\n`;
  }

  text +=
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🔗 <a href="${siteUrl()}/admin/requests">เปิดดูคำขอและจัดการโอนเงินคืนที่หลังร้าน</a>`;

  return text;
}

export type TelegramRescheduleRequestParams = {
  summary: TelegramBookingSummary;
  bookingId: string;
  newCourtName?: string | null;
  newStartsAt?: string | null;
  newEndsAt?: string | null;
  reason?: string | null;
};

/** Formats a reschedule request alert for Telegram admins. */
export function formatTelegramRescheduleRequest(params: TelegramRescheduleRequestParams): string {
  const { summary, newCourtName, newStartsAt, newEndsAt, reason } = params;
  const customerName = escapeHtml(sanitizeName(summary.customer));
  const courtName = escapeHtml(summary.court);

  let text = "";
  if (summary.party) {
    text +=
      `🏸 <b>มีคำขอเลื่อนเวลาก๊วน/ทีม</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `👥 <b>ชื่อก๊วน:</b> ${escapeHtml(summary.party.title)} (โดย ${escapeHtml(summary.party.hostName)})\n`;
  } else {
    text +=
      `🔄 <b>มีคำขอเลื่อนเวลาการจอง</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `👤 <b>ผู้จอง:</b> ${customerName}\n`;
  }

  text +=
    `📍 <b>สนามเดิม:</b> ${courtName}\n` +
    `⏰ <b>เวลาเดิม:</b> ${formatSlot(summary.startsAt, summary.endsAt)}\n`;

  if (newStartsAt && newEndsAt) {
    const courtPart = newCourtName ? `${escapeHtml(newCourtName)} · ` : "";
    text += `🆕 <b>ขอเลื่อนเป็น:</b> ${courtPart}${formatSlot(newStartsAt, newEndsAt)}\n`;
  }

  if (reason) {
    text += `📝 <b>เหตุผล:</b> ${escapeHtml(reason)}\n`;
  }

  text +=
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🔗 <a href="${siteUrl()}/admin/requests">เปิดดูและอนุมัติคำขอที่ระบบหลังร้าน</a>`;

  return text;
}

/** Formats a direct booking cancellation alert (unpaid hold released). */
export function formatTelegramCancelledBooking(summary: TelegramBookingSummary, bookingId: string): string {
  const customerName = escapeHtml(sanitizeName(summary.customer));
  const courtName = escapeHtml(summary.court);

  const multiBadge = summary.multiCourtCount && summary.multiCourtCount > 1
    ? ` <i>(เหมา ${summary.multiCourtCount} สนาม)</i>`
    : "";

  let text = "";
  if (summary.party) {
    text +=
      `🚫 <b>ยกเลิกการเปิดห้องก๊วน (ปลดล็อกสนามแล้ว)</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `👥 <b>ชื่อก๊วน:</b> ${escapeHtml(summary.party.title)}\n` +
      `👑 <b>หัวหน้าก๊วน:</b> ${escapeHtml(summary.party.hostName)}\n`;
  } else {
    text +=
      `🚫 <b>ลูกค้ายกเลิกการจองคิว (ปลดล็อกสนามแล้ว)</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n` +
      `👤 <b>ลูกค้า:</b> ${customerName}\n`;
  }

  text +=
    `📍 <b>สนาม:</b> ${courtName}${multiBadge}\n` +
    `⏰ <b>รอบเวลา:</b> ${formatSlot(summary.startsAt, summary.endsAt)}\n` +
    `💰 <b>ยอดเงิน:</b> ${formatBaht(summary.amount)}\n` +
    `ℹ️ <b>สถานะ:</b> ยกเลิกคิวแล้ว ปลดล็อกสนามว่างให้ลูกค้าท่านอื่นจองต่อได้\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `🔗 <a href="${siteUrl()}/admin">ดูผังสนามที่ระบบหลังร้าน</a>`;

  return text;
}

