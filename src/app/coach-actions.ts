"use server";

import { revalidatePath } from "next/cache";
import { isValidSlot, type AvailabilitySlot } from "@/lib/coach";
import { friendlyError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import type { ActionResult } from "./actions";

// Lessons with a coach (migration 0019). The database decides who may do what:
// a coach edits only their own profile, and only an admin records a pay-out.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function refreshCoachPages(coachId: string) {
  revalidatePath("/coaches");
  revalidatePath(`/coaches/${coachId}`);
  revalidatePath("/coach");
  revalidatePath("/admin/coaches");
}

export async function saveCoachProfile(input: {
  userId: string;
  displayName: string;
  bio: string;
  pricePerHour: number;
  isListed: boolean;
}): Promise<ActionResult> {
  const { userId, displayName, bio, pricePerHour, isListed } = input;
  if (
    !UUID_RE.test(userId) ||
    typeof displayName !== "string" ||
    typeof bio !== "string" ||
    !Number.isInteger(pricePerHour) ||
    typeof isListed !== "boolean"
  ) {
    return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("save_coach_profile", {
    p_user_id: userId,
    p_display_name: displayName,
    p_bio: bio,
    p_price: pricePerHour,
    p_is_listed: isListed,
  });
  if (error) return { ok: false, error: friendlyError(error) };
  refreshCoachPages(userId);
  return { ok: true, data: null };
}

export async function setCoachAvailability(userId: string, slots: AvailabilitySlot[]): Promise<ActionResult> {
  if (!UUID_RE.test(userId) || !Array.isArray(slots) || slots.length > 28 || !slots.every(isValidSlot)) {
    return { ok: false, error: friendlyError({ message: "INVALID_AVAILABILITY" }) };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_coach_availability", { p_user_id: userId, p_slots: slots });
  if (error) return { ok: false, error: friendlyError(error) };
  refreshCoachPages(userId);
  return { ok: true, data: null };
}

/** Holds a court and the coach, then the customer pays the usual way. */
export async function createLessonBooking(
  coachId: string,
  startsAt: string,
  hours: number,
): Promise<ActionResult<{ id: string }>> {
  if (
    !UUID_RE.test(coachId) ||
    typeof startsAt !== "string" ||
    Number.isNaN(Date.parse(startsAt)) ||
    typeof hours !== "number" ||
    hours < 1 ||
    hours > 3 ||
    Math.round(hours * 2) !== hours * 2
  ) {
    return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("create_lesson_booking", { p_coach_id: coachId, p_starts_at: startsAt, p_hours: hours })
    .single<{ id: string }>();
  if (error || !data) return { ok: false, error: friendlyError(error) };

  revalidatePath("/me");
  revalidatePath(`/coaches/${coachId}`);
  return { ok: true, data: { id: data.id } };
}

/** Admin: the shop handed the lesson fees for finished lessons to the coach. */
export async function markCoachPaid(coachId: string): Promise<ActionResult<{ count: number }>> {
  if (!UUID_RE.test(coachId)) return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("mark_coach_paid", { p_coach_id: coachId });
  if (error) return { ok: false, error: friendlyError(error) };
  revalidatePath("/admin/coaches");
  return { ok: true, data: { count: Number(data ?? 0) } };
}
