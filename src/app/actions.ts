"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { BOOKING_RULES, SLIP_MAX_BYTES } from "@/lib/config";
import { slotStart } from "@/lib/slots";
import { friendlyError } from "@/lib/errors";
import { notifyAfterSlip, notifyNewBooking, notifyPaymentReviewed } from "@/lib/line/notify-shop";
import { safeNext } from "@/lib/safe-next";
import { planAdminSlipUpload } from "@/lib/admin-slip";
import { isSlipVerificationEnabled, verifyLatestSlip } from "@/lib/slip/verify-booking";
import { createClient, getSessionUser } from "@/lib/supabase/server";
import { getServiceClient } from "@/lib/supabase/service";

export type ActionResult<T = null> = { ok: true; data: T } | { ok: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type BookingCartItemInput = {
  courtId: number;
  startsAt: string;
  hours: number;
};

export async function createBooking(input: {
  courtId?: number;
  courtIds?: number[];
  startsAt?: string;
  hours?: number;
  items?: BookingCartItemInput[];
  /** Coach accounts only (the database checks): pay later and/or an agreed bill total. */
  coach?: { payLater: boolean; total: number | null };
}): Promise<ActionResult<{ id: string }>> {
  const { courtId, courtIds, startsAt, hours, items, coach } = input;

  const normalizedItems: BookingCartItemInput[] =
    Array.isArray(items) && items.length > 0
      ? items
      : (() => {
          const ids =
            Array.isArray(courtIds) && courtIds.length > 0
              ? courtIds
              : Number.isInteger(courtId)
                ? [courtId!]
                : [];
          if (!startsAt || typeof hours !== "number") return [];
          return ids.map((id) => ({ courtId: id, startsAt, hours }));
        })();

  const isValidItem = (it: BookingCartItemInput) =>
    Number.isInteger(it.courtId) &&
    typeof it.hours === "number" &&
    it.hours >= 0.5 &&
    it.hours <= BOOKING_RULES.maxHours &&
    Math.round(it.hours * 2) === it.hours * 2 &&
    typeof it.startsAt === "string" &&
    !Number.isNaN(Date.parse(it.startsAt));

  if (
    normalizedItems.length === 0 ||
    normalizedItems.length > 8 ||
    normalizedItems.some((it) => !isValidItem(it)) ||
    (coach !== undefined &&
      (typeof coach.payLater !== "boolean" ||
        (coach.total !== null && (!Number.isInteger(coach.total) || coach.total <= 0))))
  ) {
    return { ok: false, error: "ข้อมูลการจองไม่ถูกต้อง" };
  }

  const supabase = await createClient();

  // Check if all items share the exact same startsAt and hours with distinct courts
  const firstStart = normalizedItems[0].startsAt;
  const firstHours = normalizedItems[0].hours;
  const uniqueCourts = new Set(normalizedItems.map((it) => it.courtId));
  const allSameSlot =
    uniqueCourts.size === normalizedItems.length &&
    normalizedItems.every((it) => it.startsAt === firstStart && it.hours === firstHours);

  if (allSameSlot) {
    const ids = normalizedItems.map((it) => it.courtId);
    const { data, error } = coach
      ? await supabase
          .rpc("create_coach_booking", {
            p_court_ids: ids,
            p_starts_at: firstStart,
            p_hours: firstHours,
            p_pay_later: coach.payLater,
            p_total: coach.total,
          })
          .single<{ id: string }>()
      : await supabase
          .rpc("create_multi_booking", {
            p_court_ids: ids,
            p_starts_at: firstStart,
            p_hours: firstHours,
          })
          .single<{ id: string }>();

    if (error || !data) return { ok: false, error: friendlyError(error) };
    revalidatePath("/me");
    await notifyNewBooking(data.id);
    return { ok: true, data: { id: data.id } };
  }

  // Different start times or durations per court: try atomic create_cart_booking RPC first
  const rpcPayload = normalizedItems.map((it) => ({
    court_id: it.courtId,
    starts_at: it.startsAt,
    hours: it.hours,
  }));
  const cartRpc = await supabase
    .rpc("create_cart_booking", {
      p_items: rpcPayload,
      p_pay_later: coach?.payLater ?? false,
      p_total: coach?.total ?? null,
    })
    .single<{ id: string; group_id?: string }>();

  if (!cartRpc.error && cartRpc.data) {
    revalidatePath("/me");
    await notifyNewBooking(cartRpc.data.id);
    return { ok: true, data: { id: cartRpc.data.id } };
  }

  // Fallback if 0017_multi_slot_bookings.sql is not yet migrated on the database:
  // Create each item and link them under the first booking's group_id.
  const isMissingRpc =
    cartRpc.error?.code === "PGRST202" ||
    cartRpc.error?.message?.includes("create_cart_booking");
  if (!isMissingRpc) {
    return { ok: false, error: friendlyError(cartRpc.error) };
  }

  const createdIds: string[] = [];
  let leadGroupId: string | null = null;

  for (const it of normalizedItems) {
    const res = coach
      ? await supabase
          .rpc("create_coach_booking", {
            p_court_ids: [it.courtId],
            p_starts_at: it.startsAt,
            p_hours: it.hours,
            p_pay_later: coach.payLater,
            p_total: null,
          })
          .single<{ id: string; group_id?: string }>()
      : await supabase
          .rpc("create_multi_booking", {
            p_court_ids: [it.courtId],
            p_starts_at: it.startsAt,
            p_hours: it.hours,
          })
          .single<{ id: string; group_id?: string }>();

    if (res.error || !res.data) {
      for (const cid of createdIds) {
        await supabase.rpc("cancel_booking", { p_booking_id: cid });
      }
      return { ok: false, error: friendlyError(res.error) };
    }
    createdIds.push(res.data.id);
    if (!leadGroupId) {
      leadGroupId = res.data.group_id ?? res.data.id;
    }
  }

  const service = getServiceClient();
  if (service && leadGroupId && createdIds.length > 1) {
    await service
      .from("bookings")
      .update({ group_id: leadGroupId })
      .in("id", createdIds);
  }

  revalidatePath("/me");
  await notifyNewBooking(createdIds[0]);
  return { ok: true, data: { id: createdIds[0] } };
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
    return { ok: false, error: "ยังไม่ได้ตั้งค่า API Key สำหรับ OCR (EASYSLIP หรือ TYPHOON) หรือ SUPABASE_SERVICE_ROLE_KEY" };
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
  editedAmount?: number,
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

  // An amount the admin corrected applies to the slip just approved, not to older rejected ones.
  if (approve && typeof editedAmount === "number" && Number.isFinite(editedAmount) && editedAmount > 0) {
    const service = getServiceClient();
    const { data: latest } = service
      ? await service
          .from("payments")
          .select("id")
          .eq("booking_id", bookingId)
          .eq("status", "approved")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle<{ id: string }>()
      : { data: null };
    if (service && latest) {
      const { error: amountError } = await service.from("payments").update({ slip_amount: editedAmount }).eq("id", latest.id);
      if (amountError) console.error("Failed to record edited slip amount:", amountError);
    }
  }

  // If rejected, cancel the booking immediately to release the court slot from the overview board.
  if (!approve) {
    const { error: cancelError } = await supabase.rpc("cancel_booking", { p_booking_id: bookingId });
    if (cancelError) {
      console.error("Failed to cancel booking after rejecting slip:", cancelError);
    }
  }

  await notifyPaymentReviewed(bookingId, approve, note);
  revalidatePath("/admin");
  revalidatePath("/me");
  revalidatePath(`/bookings/${bookingId}`);
  return { ok: true, data: null };
}

export type AdminBookingItemInput = {
  courtId: number;
  date: string; // YYYY-MM-DD, Bangkok
  hour: number;
  hours: number;
};

export type AdminBookingInput = {
  courtId: number;
  date: string; // YYYY-MM-DD, Bangkok
  hour: number;
  hours: number;
  items?: AdminBookingItemInput[];
  channel: "phone" | "line" | "walk_in";
  name: string;
  phone: string;
  note: string;
};

const CHANNELS = new Set(["phone", "line", "walk_in"]);

export async function adminCreateBooking(input: AdminBookingInput): Promise<ActionResult<{ id: string }>> {
  const { courtId, date, hour, hours, items, channel, name, phone, note } = input;
  const normalizedItems: AdminBookingItemInput[] =
    Array.isArray(items) && items.length > 0
      ? items
      : [{ courtId, date, hour, hours }];

  const isValidAdminItem = (it: AdminBookingItemInput) => {
    const validHour =
      typeof it.hour === "number" &&
      it.hour >= BOOKING_RULES.openHour &&
      it.hour < BOOKING_RULES.closeHour &&
      Math.round(it.hour * 2) === it.hour * 2;
    const validHours =
      typeof it.hours === "number" &&
      it.hours >= 0.5 &&
      it.hours <= 14 &&
      Math.round(it.hours * 2) === it.hours * 2;
    return Number.isInteger(it.courtId) && /^\d{4}-\d{2}-\d{2}$/.test(it.date) && validHour && validHours;
  };

  if (
    normalizedItems.length === 0 ||
    normalizedItems.length > 12 ||
    normalizedItems.some((it) => !isValidAdminItem(it)) ||
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

  if (normalizedItems.length === 1) {
    const it = normalizedItems[0];
    const { data, error } = await supabase
      .rpc("admin_create_booking", {
        p_court_id: it.courtId,
        p_starts_at: slotStart(it.date, it.hour),
        p_hours: it.hours,
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

  // Multi-item admin booking: try atomic admin_create_cart_booking first
  const rpcPayload = normalizedItems.map((it) => ({
    court_id: it.courtId,
    starts_at: slotStart(it.date, it.hour),
    hours: it.hours,
  }));
  const cartRpc = await supabase
    .rpc("admin_create_cart_booking", {
      p_items: rpcPayload,
      p_channel: channel,
      p_customer_name: name,
      p_customer_phone: phone || null,
      p_note: note || null,
    })
    .single<{ id: string }>();

  if (!cartRpc.error && cartRpc.data) {
    revalidatePath("/admin");
    return { ok: true, data: { id: cartRpc.data.id } };
  }

  const isMissingRpc =
    cartRpc.error?.code === "PGRST202" ||
    cartRpc.error?.message?.includes("admin_create_cart_booking");
  if (!isMissingRpc) {
    return { ok: false, error: friendlyError(cartRpc.error) };
  }

  // Fallback if 0017 is not yet migrated: create each booking and link group_id
  const createdIds: string[] = [];
  let leadGroupId: string | null = null;
  for (const it of normalizedItems) {
    const res = await supabase
      .rpc("admin_create_booking", {
        p_court_id: it.courtId,
        p_starts_at: slotStart(it.date, it.hour),
        p_hours: it.hours,
        p_channel: channel,
        p_customer_name: name,
        p_customer_phone: phone || null,
        p_note: note || null,
      })
      .single<{ id: string; group_id?: string }>();

    if (res.error || !res.data) {
      for (const cid of createdIds) {
        await supabase.rpc("cancel_booking", { p_booking_id: cid });
      }
      return { ok: false, error: friendlyError(res.error) };
    }
    createdIds.push(res.data.id);
    if (!leadGroupId) {
      leadGroupId = res.data.group_id ?? res.data.id;
    }
  }

  const service = getServiceClient();
  if (service && leadGroupId && createdIds.length > 1) {
    await service
      .from("bookings")
      .update({ group_id: leadGroupId })
      .in("id", createdIds);
  }

  revalidatePath("/admin");
  return { ok: true, data: { id: createdIds[0] } };
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

const SLIP_EXTENSIONS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/**
 * Admin-only: upload a slip image for any booking (bypasses Storage RLS).
 * Used when the admin creates a booking on behalf of a customer and wants to
 * attach the payment slip right away.
 *
 * A booking the admin already confirmed (phone / LINE / walk-in) stays confirmed:
 * the slip is kept as an approved receipt and never enters the review queue, so a
 * later "reject" cannot cancel it. An unpaid booking goes to review as usual.
 */
export async function adminUploadSlipFile(formData: FormData): Promise<ActionResult<{ path: string }>> {
  const bookingId = String(formData.get("bookingId") ?? "");
  const file = formData.get("file");

  if (!UUID_RE.test(bookingId) || !(file instanceof File) || file.size === 0) {
    return { ok: false, error: "ข้อมูลไม่ถูกต้อง" };
  }
  const ext = SLIP_EXTENSIONS[file.type];
  if (!ext) return { ok: false, error: "รองรับเฉพาะรูป JPG, PNG หรือ WEBP" };
  if (file.size > SLIP_MAX_BYTES) return { ok: false, error: "ไฟล์ใหญ่เกิน 4MB" };

  const { isAdmin, user } = await getSessionUser();
  if (!isAdmin || !user) return { ok: false, error: friendlyError({ message: "FORBIDDEN" }) };

  const supabase = getServiceClient();
  if (!supabase) return { ok: false, error: "ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ (ยังไม่ได้ตั้งค่า Service Role Key)" };

  // Fetch booking details (including group_id so multi-court bills sum together)
  const { data: booking, error: bookingErr } = await supabase
    .from("bookings")
    .select("id, user_id, amount, status, group_id")
    .eq("id", bookingId)
    .single<{ id: string; user_id: string; amount: number; status: string; group_id?: string }>();

  if (bookingErr || !booking) {
    return { ok: false, error: "ไม่พบข้อมูลการจอง" };
  }
  const plan = planAdminSlipUpload(booking.status);
  if (!plan.allowed) return { ok: false, error: plan.error };
  const isConfirmed = plan.keepConfirmed;

  let groupAmount = Number(booking.amount);
  const groupId = booking.group_id ?? booking.id;
  const { data: groupRows } = await supabase
    .from("bookings")
    .select("amount")
    .eq("group_id", groupId);
  if (groupRows && groupRows.length > 0) {
    groupAmount = groupRows.reduce((sum, r) => sum + Number(r.amount), 0);
  }

  const path = `${booking.user_id}/${bookingId}-${Date.now()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await supabase.storage
    .from("slips")
    .upload(path, buffer, { contentType: file.type });
  if (uploadError) {
    console.error("Admin slip upload failed:", uploadError);
    return { ok: false, error: "อัปโหลดไม่สำเร็จ กรุณาลองใหม่" };
  }

  // Insert payment record with full group amount
  const { error: paymentError } = await supabase.from("payments").insert({
    booking_id: bookingId,
    user_id: booking.user_id,
    amount: groupAmount,
    slip_path: path,
    ...(isConfirmed
      ? { status: "approved", reviewed_by: user.id, reviewed_at: new Date().toISOString() }
      : { status: "submitted" }),
  });
  if (paymentError) {
    console.error("Admin payment insert failed:", paymentError);
    return { ok: false, error: "บันทึกข้อมูลการชำระเงินไม่สำเร็จ" };
  }

  // An already-confirmed booking keeps its status: the slip is a receipt, not a
  // request to review, so a later "reject" cannot cancel a booking already paid for.
  if (isConfirmed) {
    revalidatePath("/admin");
    revalidatePath(`/bookings/${bookingId}`);
    return { ok: true, data: { path } };
  }

  // Update all bookings in the group to awaiting_review so they appear together on the review page
  const { error: updateError } = await supabase
    .from("bookings")
    .update({
      status: "awaiting_review",
      hold_expires_at: null,
      review_note: null,
    })
    .eq("group_id", groupId);
  if (updateError) {
    console.error("Admin booking update failed:", updateError);
    return { ok: false, error: "อัปเดตสถานะการจองไม่สำเร็จ" };
  }

  // Auto-check with OCR and notify
  const verifyStatus = await verifyLatestSlip(bookingId);
  await notifyAfterSlip(bookingId, verifyStatus);

  revalidatePath("/admin");
  revalidatePath("/admin/review");
  revalidatePath(`/bookings/${bookingId}`);

  return { ok: true, data: { path } };
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
