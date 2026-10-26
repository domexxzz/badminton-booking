const dateFmt = new Intl.DateTimeFormat("th-TH", {
  timeZone: "Asia/Bangkok",
  weekday: "short",
  day: "numeric",
  month: "short",
});

const timeFmt = new Intl.DateTimeFormat("th-TH", {
  timeZone: "Asia/Bangkok",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export const formatDate = (iso: string) => dateFmt.format(new Date(iso));

// For Bangkok calendar days given as "YYYY-MM-DD" (noon avoids any day shift).
const dayDate = (day: string) => new Date(`${day}T12:00:00+07:00`);
const weekdayFmt = new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", weekday: "short" });
const monthFmt = new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", month: "short" });
const dayLongFmt = new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", weekday: "long", day: "numeric", month: "long" });
export const formatDayParts = (day: string) => ({
  weekday: weekdayFmt.format(dayDate(day)),
  date: Number(day.slice(8, 10)),
  month: monthFmt.format(dayDate(day)),
});
export const formatDayShort = (day: string) => dateFmt.format(dayDate(day));
export const formatDayLong = (day: string) => dayLongFmt.format(dayDate(day));
export const formatTime = (iso: string) => timeFmt.format(new Date(iso));
export const formatBaht = (amount: number) =>
  `฿${Math.round(Number(amount)).toLocaleString("th-TH")}`;

export function formatSlot(startsAt: string, endsAt: string): string {
  // Midnight close shows as 24:00 instead of 00:00.
  const end = formatTime(endsAt) === "00:00" ? "24:00" : formatTime(endsAt);
  return `${formatDate(startsAt)} · ${formatTime(startsAt)}–${end}`;
}

export const CHANNEL_LABEL: Record<string, string> = {
  online: "🌐 ออนไลน์",
  phone: "📞 โทร",
  line: "💬 LINE",
  walk_in: "🏸 หน้าร้าน",
};

export const STATUS_LABEL: Record<string, string> = {
  pending_payment: "รอชำระเงิน",
  awaiting_review: "รอตรวจสลิป",
  confirmed: "ยืนยันแล้ว",
  cancelled: "ยกเลิก",
  expired: "หมดเวลาชำระ",
};

/** A length of time in hours as Thai: "2 ชม. 30 นาที", "1 ชม.", "30 นาที". */
export function formatDuration(hours: number): string {
  const whole = Math.floor(hours);
  const minutes = Math.round((hours - whole) * 60);
  return [whole > 0 ? `${whole} ชม.` : null, minutes > 0 ? `${minutes} นาที` : null].filter(Boolean).join(" ");
}
