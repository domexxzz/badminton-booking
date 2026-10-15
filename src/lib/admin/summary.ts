import { BOOKING_RULES } from "../config";

export type BookingForSummary = {
  status: string;
  amount: number | string;
  starts_at: string;
  ends_at: string;
};

const HOUR_MS = 60 * 60 * 1000;
const OPEN_STATUSES = new Set(["pending_payment", "awaiting_review"]);

const hoursOf = (b: BookingForSummary) => (Date.parse(b.ends_at) - Date.parse(b.starts_at)) / HOUR_MS;
const satang = (amount: number | string) => Math.round(Number(amount) * 100);

/** Revenue counts confirmed bookings only, by the day they are played. */
export function confirmedRevenue(bookings: readonly BookingForSummary[]): number {
  return bookings.filter((b) => b.status === "confirmed").reduce((sum, b) => sum + satang(b.amount), 0) / 100;
}

export function summarizeDay(bookings: readonly BookingForSummary[], courtCount: number) {
  const confirmed = bookings.filter((b) => b.status === "confirmed");
  const bookedHours = confirmed.reduce((sum, b) => sum + hoursOf(b), 0);
  const capacityHours = courtCount * (BOOKING_RULES.closeHour - BOOKING_RULES.openHour);
  return {
    revenue: confirmedRevenue(bookings),
    confirmedCount: confirmed.length,
    waitingCount: bookings.filter((b) => OPEN_STATUSES.has(b.status)).length,
    bookedHours,
    utilization: capacityHours > 0 ? Math.round((bookedHours / capacityHours) * 100) : 0,
  };
}

/** First day of the month containing `day`, and of the next month ("YYYY-MM-DD"). */
export function monthBounds(day: string): { start: string; next: string } {
  const [y, m] = day.split("-").map(Number);
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  return {
    start: `${y}-${String(m).padStart(2, "0")}-01`,
    next: `${nextY}-${String(nextM).padStart(2, "0")}-01`,
  };
}
