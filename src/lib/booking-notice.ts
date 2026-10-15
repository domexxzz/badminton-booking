export type BookingNotice = "submitted" | "confirmed" | "rejected" | "expired";

/**
 * Which popup to show when a booking moves from `prev` to `current` status
 * while (or since) the customer last looked. Null on first sight or no change.
 */
export function noticeForTransition(prev: string | null, current: string, reviewNote: string | null): BookingNotice | null {
  if (prev === null || prev === current) return null;
  if (current === "confirmed") return "confirmed";
  if (prev === "pending_payment" && current === "awaiting_review") return "submitted";
  // An admin (or the auto-check) sent the slip back: the booking reopens for a new slip.
  if (prev === "awaiting_review" && current === "pending_payment" && reviewNote) return "rejected";
  if (current === "expired" && (prev === "pending_payment" || prev === "awaiting_review")) return "expired";
  return null;
}
