"use server";

import { revalidatePath } from "next/cache";
import { friendlyError } from "@/lib/errors";
import { notifyBookingRequest } from "@/lib/line/notify-shop";
import { slotStart } from "@/lib/slots";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "./actions";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TEXT = 300;

function refresh(bookingId: string) {
  revalidatePath(`/bookings/${bookingId}`);
  revalidatePath("/me");
  revalidatePath("/admin", "layout");
}

export async function requestReschedule(input: {
  bookingId: string;
  courtId: number;
  date: string; // YYYY-MM-DD, Bangkok
  hour: number; // e.g. 17.5 = 17:30
}): Promise<ActionResult> {
  const { bookingId, courtId, date, hour } = input;
  if (
    !UUID_RE.test(bookingId) ||
    !Number.isInteger(courtId) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    typeof hour !== "number" ||
    Math.round(hour * 2) !== hour * 2
  ) {
    return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_reschedule", {
    p_booking_id: bookingId,
    p_court_id: courtId,
    p_starts_at: slotStart(date, hour),
  });
  if (error) return { ok: false, error: friendlyError(error) };
  await notifyBookingRequest(bookingId, "reschedule");
  refresh(bookingId);
  return { ok: true, data: null };
}

export async function requestCancel(bookingId: string, qrPath: string, reason: string): Promise<ActionResult> {
  if (!UUID_RE.test(bookingId) || typeof qrPath !== "string" || typeof reason !== "string") {
    return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_cancel", {
    p_booking_id: bookingId,
    p_qr_path: qrPath,
    p_reason: reason.slice(0, MAX_TEXT) || null,
  });
  if (error) return { ok: false, error: friendlyError(error) };
  await notifyBookingRequest(bookingId, "cancel");
  refresh(bookingId);
  return { ok: true, data: null };
}

export async function withdrawRequest(requestId: string, bookingId: string): Promise<ActionResult> {
  if (!UUID_RE.test(requestId) || !UUID_RE.test(bookingId)) return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("withdraw_request", { p_request_id: requestId });
  if (error) return { ok: false, error: friendlyError(error) };
  refresh(bookingId);
  return { ok: true, data: null };
}

export async function resolveRequest(input: {
  requestId: string;
  bookingId: string;
  approve: boolean;
  note: string;
  refundSlipPath: string | null;
}): Promise<ActionResult> {
  const { requestId, bookingId, approve, note, refundSlipPath } = input;
  if (!UUID_RE.test(requestId) || !UUID_RE.test(bookingId) || typeof approve !== "boolean" || typeof note !== "string") {
    return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("resolve_request", {
    p_request_id: requestId,
    p_approve: approve,
    p_note: note.slice(0, MAX_TEXT) || null,
    p_refund_slip_path: refundSlipPath,
  });
  if (error) return { ok: false, error: friendlyError(error) };
  refresh(bookingId);
  return { ok: true, data: null };
}
