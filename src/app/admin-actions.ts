"use server";

import { revalidatePath } from "next/cache";
import { friendlyError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "./actions";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function setAdmin(userId: string, isAdmin: boolean): Promise<ActionResult> {
  if (!UUID_RE.test(userId) || typeof isAdmin !== "boolean") return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_admin", { p_user_id: userId, p_is_admin: isAdmin });
  if (error) return { ok: false, error: friendlyError(error) };
  revalidatePath("/admin/team");
  return { ok: true, data: null };
}

export async function updateVenueHoursAction(openHour: number, closeHour: number): Promise<ActionResult> {
  if (
    typeof openHour !== "number" ||
    typeof closeHour !== "number" ||
    openHour < 0 ||
    closeHour > 24 ||
    openHour >= closeHour
  ) {
    return { ok: false, error: "เวลาเปิดและเวลาปิดไม่ถูกต้อง" };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("update_venue_hours", {
    p_open_hour: openHour,
    p_close_hour: closeHour,
  });
  if (error) return { ok: false, error: friendlyError(error) };
  revalidatePath("/");
  revalidatePath("/book");
  revalidatePath("/schedule");
  revalidatePath("/admin");
  revalidatePath("/admin/settings");
  return { ok: true, data: null };
}

export async function setCoach(userId: string, isCoach: boolean): Promise<ActionResult> {
  if (!UUID_RE.test(userId) || typeof isCoach !== "boolean") return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_coach", { p_user_id: userId, p_is_coach: isCoach });
  if (error) return { ok: false, error: friendlyError(error) };
  revalidatePath("/admin/team");
  return { ok: true, data: null };
}

/** The shop received the money for a pay-later bill. */
export async function markBookingPaid(bookingId: string): Promise<ActionResult> {
  if (!UUID_RE.test(bookingId)) return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_booking_paid", { p_booking_id: bookingId });
  if (error) return { ok: false, error: friendlyError(error) };
  revalidatePath("/admin", "layout");
  revalidatePath(`/bookings/${bookingId}`);
  return { ok: true, data: null };
}
