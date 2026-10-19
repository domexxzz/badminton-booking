"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { BOOKING_RULES } from "@/lib/config";
import { slotStart } from "@/lib/slots";
import { friendlyError } from "@/lib/errors";
import { notifyAfterSlip, notifyNewBooking, notifyPaymentReviewed } from "@/lib/line/notify-shop";
import { safeNext } from "@/lib/safe-next";
import { isSlipVerificationEnabled, verifyLatestSlip } from "@/lib/slip/verify-booking";
import { createClient, getSessionUser } from "@/lib/supabase/server";

export type ActionResult<T = null> = { ok: true; data: T } | { ok: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function createBooking(input: {
  courtId?: number;
  courtIds?: number[];
  startsAt: string;
  hours: number;
  /** Coach accounts only (the database checks): pay later and/or an agreed bill total. */
  coach?: { payLater: boolean; total: number | null };
}): Promise<ActionResult<{ id: string }>> {
  const { courtId, courtIds, startsAt, hours, coach } = input;
  const ids = Array.isArray(courtIds) && courtIds.length > 0
    ? courtIds
    : Number.isInteger(courtId)
      ? [courtId!]
      : [];

  const validHours =
    typeof hours === "number" &&
    hours >= 0.5 &&
    hours <= BOOKING_RULES.maxHours &&
    Math.round(hours * 2) === hours * 2;
  if (
    ids.length === 0 ||
    ids.some((id) => !Number.isInteger(id)) ||
    !validHours ||
    Number.isNaN(Date.parse(startsAt)) ||
    (coach !== undefined &&
      (typeof coach.payLater !== "boolean" ||
        (coach.total !== null && (!Number.isInteger(coach.total) || coach.total <= 0))))
  ) {
    return { ok: false, error: "ข้อมูลการจองไม่ถูกต้อง" };
  }

  const supabase = await createClient();
  const { data, error } = coach
    ? await supabase
        .rpc("create_coach_booking", {
          p_court_ids: ids,
          p_starts_at: startsAt,
          p_hours: hours,
          p_pay_later: coach.payLater,
          p_total: coach.total,
        })
        .single<{ id: string }>()
    : await supabase
        .rpc("create_multi_booking", { p_court_ids: ids, p_starts_at: startsAt, p_hours: hours })
        .single<{ id: string }>();

  if (error || !data) return { ok: false, error: friendlyError(error) };
  revalidatePath("/me");
  await notifyNewBooking(data.id);
  return { ok: true, data: { id: data.id } };
}

export async function submitSlip(bookingId: string, slipPath: string): Promise<ActionResult> {
  if (!UUID_RE.test(bookingId) || typeof slipPath !== "string") {
    return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("submit_slip", { p_booking_id: bookingId, p_slip_path: slipPath });
  if (error) return { ok: false, error: friendlyError(error) };

  // Auto-check right away; if it can't decide, the slip waits for an admin.
  const verifyStatus = await verifyLatestSlip(bookingId);
  await notifyAfterSlip(bookingId, verifyStatus);

  revalidatePath(`/bookings/${bookingId}`);
  revalidatePath("/admin");
  return { ok: true, data: null };
}

export async function recheckSlip(bookingId: string): Promise<ActionResult> {
  if (!UUID_RE.test(bookingId)) return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };
  const { isAdmin } = await getSessionUser();
  if (!isAdmin) return { ok: false, error: friendlyError({ message: "FORBIDDEN" }) };
  if (!isSlipVerificationEnabled()) {
    return { ok: false, error: "ยังไม่ได้ตั้งค่า EASYSLIP_API_KEY / SUPABASE_SERVICE_ROLE_KEY" };
  }

  const status = await verifyLatestSlip(bookingId);
  revalidatePath("/admin");
  revalidatePath(`/bookings/${bookingId}`);
  return status ? { ok: true, data: null } : { ok: false, error: "ตรวจไม่สำเร็จ ดู log ฝั่งเซิร์ฟเวอร์" };
}

export async function cancelBooking(bookingId: string): Promise<ActionResult> {
  if (!UUID_RE.test(bookingId)) return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("cancel_booking", { p_booking_id: bookingId });
  if (error) return { ok: false, error: friendlyError(error) };

  revalidatePath("/me");
  revalidatePath(`/bookings/${bookingId}`);
  revalidatePath("/admin");
  return { ok: true, data: null };
}

export async function reviewPayment(
  bookingId: string,
  approve: boolean,
  note: string,
): Promise<ActionResult> {
  if (!UUID_RE.test(bookingId) || typeof approve !== "boolean") {
    return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };
  }
  const supabase = await createClient();
  const { error } = await supabase.rpc("review_payment", {
    p_booking_id: bookingId,
    p_approve: approve,
    p_note: note.slice(0, 300) || null,
  });
  if (error) return { ok: false, error: friendlyError(error) };

  await notifyPaymentReviewed(bookingId, approve, note);
  revalidatePath("/admin");
  return { ok: true, data: null };
}

export type AdminBookingInput = {
  courtId: number;
  date: string; // YYYY-MM-DD, Bangkok
  hour: number;
  hours: number;
  channel: "phone" | "line" | "walk_in";
  name: string;
  phone: string;
  note: string;
};

const CHANNELS = new Set(["phone", "line", "walk_in"]);

export async function adminCreateBooking(input: AdminBookingInput): Promise<ActionResult<{ id: string }>> {
  const { courtId, date, hour, hours, channel, name, phone, note } = input;
  const validHour =
    typeof hour === "number" &&
    hour >= BOOKING_RULES.openHour &&
    hour < BOOKING_RULES.closeHour &&
    Math.round(hour * 2) === hour * 2;
  const validHours =
    typeof hours === "number" &&
    hours >= 0.5 &&
    hours <= 14 &&
    Math.round(hours * 2) === hours * 2;
  if (
    !Number.isInteger(courtId) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !validHour ||
    !validHours ||
    !CHANNELS.has(channel) ||
    typeof name !== "string" ||
    name.trim().length === 0 ||
    name.length > 100 ||
    phone.length > 20 ||
    note.length > 300
  ) {
    return { ok: false, error: "ข้อมูลการจองไม่ครบหรือไม่ถูกต้อง" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("admin_create_booking", {
      p_court_id: courtId,
      p_starts_at: slotStart(date, hour),
      p_hours: hours,
      p_channel: channel,
      p_customer_name: name,
      p_customer_phone: phone || null,
      p_note: note || null,
    })
    .single<{ id: string }>();
  if (error || !data) return { ok: false, error: friendlyError(error) };

  revalidatePath("/admin");
  return { ok: true, data: { id: data.id } };
}

export async function markBankNotificationHandled(id: string): Promise<ActionResult> {
  if (!UUID_RE.test(id)) return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_bank_notification_handled", { p_id: id });
  if (error) return { ok: false, error: friendlyError(error) };
  revalidatePath("/admin");
  return { ok: true, data: null };
}

export async function signInWithEmail(_prev: string | null, formData: FormData): Promise<string | null> {
  const email = String(formData.get("email") ?? "").trim();
  const next = String(formData.get("next") ?? "/");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.toLowerCase().endsWith("@line-login.invalid")) {
    return "อีเมลไม่ถูกต้อง";
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${siteUrl}/auth/callback?next=${encodeURIComponent(safeNext(next))}` },
  });
  if (error) {
    console.error("signInWithOtp failed:", error);
    return "ส่งลิงก์เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่";
  }
  return "sent";
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
