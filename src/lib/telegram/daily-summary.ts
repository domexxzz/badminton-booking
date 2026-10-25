import { createHash, timingSafeEqual } from "node:crypto";
import { countBookings, summarizeDay, type BookingForSummary } from "@/lib/admin/summary";
import { STATUS_LABEL, formatBaht, formatDayShort, formatTime } from "@/lib/format";
import { sanitizeName } from "@/lib/line/messages";
import { bangkokDate, slotStart } from "@/lib/slots";
import { escapeHtml, siteUrl } from "./messages";

export type DailySummaryKind = "morning" | "closing";

export type DailySummaryBooking = BookingForSummary & {
  court_id: number;
  customer?: { name: string | null; phone: string | null };
};

export type DailySummaryInput = {
  kind: DailySummaryKind;
  day: string;
  courts: readonly { id: number; name: string }[];
  /** Every booking that starts on `day`, whatever its status. */
  bookings: readonly DailySummaryBooking[];
  pending: { awaitingReview: number; cancelRequests: number; rescheduleRequests: number };
  /** Closing summary only: what is already booked for the following day. */
  nextDay?: { day: string; bookings: readonly DailySummaryBooking[] };
};

const HOUR_MS = 60 * 60 * 1000;
// A closing summary sent before 06:00 is about the day that just ended.
const CLOSING_LOOKBACK_MS = 6 * HOUR_MS;
const DIVIDER = "━━━━━━━━━━━━━━━━━━━━";
// Keeps a busy day's message well under Telegram's 4096-character limit.
const MAX_CUSTOMER_LINES = 40;
const ACTIVE_STATUSES = new Set(["confirmed", "pending_payment", "awaiting_review"]);

/** Which Bangkok day a summary sent at `now` describes, and the day after it for a closing summary. */
export function summaryDays(kind: DailySummaryKind, now: Date): { day: string; nextDay: string | null } {
  if (kind === "morning") return { day: bangkokDate(now), nextDay: null };
  const day = bangkokDate(new Date(now.getTime() - CLOSING_LOOKBACK_MS));
  return { day, nextDay: bangkokDate(new Date(slotStart(day, 24))) };
}

const hoursLabel = (hours: number) => `${Number(hours.toFixed(1))} ชม.`;
const endLabel = (iso: string) => (formatTime(iso) === "00:00" ? "24:00" : formatTime(iso));

/** Confirmed hours on one court, with back-to-back bookings merged into one range. */
function courtLine(name: string, bookings: readonly DailySummaryBooking[]): string {
  const sorted = bookings
    .filter((b) => b.status === "confirmed")
    .toSorted((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
  if (sorted.length === 0) return `• ${escapeHtml(name)}: ไม่มีการจอง`;

  const ranges = sorted.reduce<{ start: string; end: string }[]>((acc, b) => {
    const last = acc.at(-1);
    if (last && Date.parse(last.end) === Date.parse(b.starts_at)) {
      return [...acc.slice(0, -1), { start: last.start, end: b.ends_at }];
    }
    return [...acc, { start: b.starts_at, end: b.ends_at }];
  }, []);
  const hours = sorted.reduce((sum, b) => sum + (Date.parse(b.ends_at) - Date.parse(b.starts_at)) / HOUR_MS, 0);
  const times = ranges.map((r) => `${formatTime(r.start)}–${endLabel(r.end)}`).join(", ");
  return `• ${escapeHtml(name)}: ${hoursLabel(hours)} (${times})`;
}

/** Who is booked, by start time: confirmed and still-open bookings only. */
function customerLines(courts: DailySummaryInput["courts"], bookings: readonly DailySummaryBooking[]): string | null {
  const courtName = new Map(courts.map((c) => [c.id, c.name]));
  const active = bookings
    .filter((b) => ACTIVE_STATUSES.has(b.status))
    .toSorted((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at) || a.court_id - b.court_id);
  if (active.length === 0) return null;

  const lines = active.slice(0, MAX_CUSTOMER_LINES).map((b) => {
    const name = escapeHtml(sanitizeName(b.customer?.name ?? ""));
    const phone = b.customer?.phone ? `<code>${escapeHtml(b.customer.phone)}</code>` : "ไม่มีเบอร์";
    const status = b.status === "confirmed" ? "" : ` (${STATUS_LABEL[b.status] ?? b.status})`;
    const court = escapeHtml(courtName.get(b.court_id) ?? "สนาม");
    return `• ${formatTime(b.starts_at)}–${endLabel(b.ends_at)} ${court} · ${name} · ${phone}${status}`;
  });
  const hidden = active.length - lines.length;
  const more = hidden > 0 ? `\n…และอีก ${hidden} รายการ ดูที่หลังร้าน` : "";
  return `👥 <b>รายชื่อลูกค้า</b>\n${lines.join("\n")}${more}`;
}

function pendingLines({ awaitingReview, cancelRequests, rescheduleRequests }: DailySummaryInput["pending"]): string {
  const lines = [
    awaitingReview > 0 ? `• สลิปรอตรวจ ${awaitingReview}` : null,
    cancelRequests > 0 ? `• คำขอยกเลิก/คืนเงิน ${cancelRequests}` : null,
    rescheduleRequests > 0 ? `• คำขอเลื่อน ${rescheduleRequests}` : null,
  ].filter((line): line is string => line !== null);
  return lines.length > 0 ? lines.join("\n") : "ไม่มีงานค้าง ✅";
}

function nextDayLine(day: string, bookings: readonly DailySummaryBooking[], courtCount: number): string {
  const counts = countBookings(bookings);
  const { bookedHours } = summarizeDay(bookings, courtCount);
  const parts = [
    `ยืนยัน ${counts.confirmed}`,
    counts.waiting > 0 ? `รอชำระ/รอตรวจ ${counts.waiting}` : null,
    hoursLabel(bookedHours),
  ].filter((part): part is string => part !== null);
  return `📅 <b>จองไว้แล้วสำหรับ ${formatDayShort(day)}:</b> ${parts.join(" · ")}`;
}

/** Formats the morning or closing daily summary for the shop's Telegram group. */
export function formatTelegramDailySummary(input: DailySummaryInput): string {
  const { kind, day, courts, bookings, pending, nextDay } = input;
  const summary = summarizeDay(bookings, courts.length);
  const counts = countBookings(bookings);

  const title =
    kind === "closing" ? `📊 <b>สรุปยอดปิดวัน · ${formatDayShort(day)}</b>` : `☀️ <b>สรุปเช้านี้ · ${formatDayShort(day)}</b>`;
  const courtLines = courts.map((c) => courtLine(c.name, bookings.filter((b) => b.court_id === c.id))).join("\n");

  const sections = [
    `${title}\n${DIVIDER}`,
    `💰 <b>รายรับ:</b> ${formatBaht(summary.revenue)} (ยืนยันแล้ว)\n` +
      `📋 <b>การจอง:</b> ยืนยัน ${counts.confirmed} · รอชำระ/รอตรวจ ${counts.waiting} · ยกเลิก/หมดเวลา ${counts.dropped}\n` +
      `⏱️ <b>ใช้สนาม:</b> ${hoursLabel(summary.bookedHours)} (${summary.utilization}%)`,
    `🏸 <b>แยกรายสนาม</b>\n${courtLines}`,
    customerLines(courts, bookings),
    `🛎️ <b>งานค้างของแอดมิน</b>\n${pendingLines(pending)}`,
    nextDay ? nextDayLine(nextDay.day, nextDay.bookings, courts.length) : null,
    `${DIVIDER}\n🔗 <a href="${siteUrl()}/admin">เปิดระบบหลังร้าน</a>`,
  ];
  return sections.filter((s): s is string => s !== null).join("\n\n");
}

const json = (status: number, body: unknown) => Response.json(body, { status });
const sha256 = (s: string) => createHash("sha256").update(s).digest();

function bearerMatches(header: string | null, secret: string): boolean {
  const token = header?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? "";
  // Hash both sides so the comparison is constant-time regardless of length.
  return timingSafeEqual(sha256(token), sha256(secret));
}

/**
 * POST handler for the scheduler: `?kind=morning|closing` with `Authorization: Bearer <CRON_SECRET>`.
 * Answers 502 when Telegram did not take the message, so a failed run shows up in the scheduler.
 */
export function createDailySummaryHandler(deps: {
  secret: string | undefined;
  send: (kind: DailySummaryKind) => Promise<boolean>;
}) {
  return async (request: Request): Promise<Response> => {
    const secret = deps.secret?.trim();
    if (!secret) return json(503, { ok: false, error: "daily summary is not configured" });
    if (!bearerMatches(request.headers.get("authorization"), secret)) return json(401, { ok: false, error: "unauthorized" });

    const kind = new URL(request.url).searchParams.get("kind");
    if (kind !== "morning" && kind !== "closing") return json(400, { ok: false, error: "kind must be morning or closing" });

    const sent = await deps.send(kind);
    return sent ? json(200, { ok: true }) : json(502, { ok: false, error: "telegram send failed" });
  };
}
