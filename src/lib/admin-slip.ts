/**
 * What attaching a slip may do to the booking an admin picked.
 *
 * A booking the admin already confirmed (phone / LINE / walk-in) keeps that
 * status: the slip is an approved receipt, not something to review, so a later
 * "reject" can never cancel a booking that was already paid for.
 *
 * `status` is whatever the bookings row reports. An absent status means the
 * caller did not read the column, so nothing is allowed — guessing here once
 * cost us the admin slip upload entirely.
 */
export type AdminSlipPlan =
  | { allowed: true; keepConfirmed: boolean }
  | { allowed: false; error: string };

export function planAdminSlipUpload(status: string | null | undefined): AdminSlipPlan {
  if (status === "confirmed") return { allowed: true, keepConfirmed: true };
  if (status === "pending_payment") return { allowed: true, keepConfirmed: false };
  if (status === "awaiting_review") return { allowed: false, error: "การจองนี้มีสลิปรอตรวจอยู่แล้ว" };
  return { allowed: false, error: "แนบสลิปไม่ได้ การจองนี้ถูกยกเลิกหรือหมดเวลาแล้ว" };
}
