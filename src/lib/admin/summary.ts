import { BOOKING_RULES } from "../config";

export type BookingForSummary = {
  status: string;
  amount: number | string;
  starts_at: string;
  ends_at: string;
  /** Pay-later bookings are confirmed straight away and owed until paid_at is set. */
  pay_later?: boolean | null;
  paid_at?: string | null;
};

const HOUR_MS = 60 * 60 * 1000;
const OPEN_STATUSES = new Set(["pending_payment", "awaiting_review"]);

const hoursOf = (b: BookingForSummary) => (Date.parse(b.ends_at) - Date.parse(b.starts_at)) / HOUR_MS;
const satang = (amount: number | string) => Math.round(Number(amount) * 100);

/** A confirmed pay-later booking the shop has not been paid for yet (same rule as the board). */
export const isOwed = (b: BookingForSummary) => b.status === "confirmed" && b.pay_later === true && !b.paid_at;

/**
 * Revenue is money received: confirmed bookings, by the day they are played, leaving out
 * pay-later bills still owed (they count once an admin marks them paid).
 */
export function confirmedRevenue(bookings: readonly BookingForSummary[]): number {
  return (
    bookings.filter((b) => b.status === "confirmed" && !isOwed(b)).reduce((sum, b) => sum + satang(b.amount), 0) / 100
  );
}

/** What pay-later customers still owe. */
export function owedAmount(bookings: readonly BookingForSummary[]): number {
  return bookings.filter(isOwed).reduce((sum, b) => sum + satang(b.amount), 0) / 100;
}

/** A booking that was cancelled or never paid for is not a booking the shop had. */
const DROPPED_STATUSES = new Set(["cancelled", "expired"]);

/**
 * How many bookings a period really holds. `active` is what the shop counts as a
 * booking — confirmed, or still on its way there. Cancelled and expired rows are
 * reported separately instead of being folded into the total.
 */
export function countBookings(bookings: readonly { status: string }[]) {
  const confirmed = bookings.filter((b) => b.status === "confirmed").length;
  const waiting = bookings.filter((b) => OPEN_STATUSES.has(b.status)).length;
  const dropped = bookings.filter((b) => DROPPED_STATUSES.has(b.status)).length;
  return { confirmed, waiting, dropped, active: confirmed + waiting };
}

export function summarizeDay(bookings: readonly BookingForSummary[], courtCount: number) {
  const confirmed = bookings.filter((b) => b.status === "confirmed");
  const bookedHours = confirmed.reduce((sum, b) => sum + hoursOf(b), 0);
  const capacityHours = courtCount * (BOOKING_RULES.closeHour - BOOKING_RULES.openHour);
  return {
    revenue: confirmedRevenue(bookings),
    owed: owedAmount(bookings),
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
