import "server-only";
import { formatTime } from "@/lib/format";
import { getServiceClient } from "@/lib/supabase/service";
import {
  bookingConfirmedText,
  customerBookingConfirmedText,
  customerRequestResolvedText,
  customerSlipRejectedText,
  customerSlipSubmittedText,
  newBookingAlertText,
  sanitizeName,
  slipNeedsReviewText,
  unmatchedTransferText,
  type BookingSummary,
  type ShopEvent,
} from "./messages";
import { multicastText } from "./messaging";

const DEFAULT_EVENTS = "confirmed,needs_review,unmatched,request,new_booking";

function enabled(event: ShopEvent | "new_booking"): boolean {
  const events = (process.env.LINE_NOTIFY_EVENTS ?? DEFAULT_EVENTS).split(",").map((e) => e.trim());
  return Boolean(process.env.LINE_MESSAGING_TOKEN) && events.includes(event);
}

/** Pushes a message to every admin who logged in with LINE. Never throws. */
async function notifyAdmins(text: string): Promise<void> {
  try {
    const supabase = getServiceClient();
    if (!supabase) return;
    const { data, error } = await supabase
      .from("profiles")
      .select("line_user_id")
      .eq("is_admin", true)
      .not("line_user_id", "is", null);
    if (error) throw error;
    await multicastText(
      process.env.LINE_MESSAGING_TOKEN!,
      data.map((p) => p.line_user_id as string),
      text,
    );
  } catch (error) {
    console.error("Shop LINE notification failed:", error);
  }
}

/** Pushes a direct message to a specific customer if they connected LINE. Never throws. */
export async function notifyCustomer(userId: string | undefined, text: string): Promise<void> {
  if (!userId) return;
  try {
    const supabase = getServiceClient();
    if (!supabase) return;
    const { data: profile } = await supabase
      .from("profiles")
      .select("line_user_id")
      .eq("id", userId)
      .maybeSingle();
    if (!profile?.line_user_id) return;
    await multicastText(process.env.LINE_MESSAGING_TOKEN!, [profile.line_user_id], text);
  } catch (error) {
    console.error("Customer LINE notification failed:", error);
  }
}

async function loadBookingSummary(bookingId: string): Promise<BookingSummary | null> {
  const supabase = getServiceClient();
  if (!supabase) return null;
  const { data: b } = await supabase
    .from("bookings")
    .select("starts_at, ends_at, amount, group_id, channel, customer_name, user_id, courts(name)")
    .eq("id", bookingId)
    .maybeSingle<{
      starts_at: string;
      ends_at: string;
      amount: number;
      group_id?: string;
      channel: string;
      customer_name: string | null;
      user_id: string;
      courts: { name: string } | null;
    }>();
  if (!b) return null;

  let courtName = b.courts?.name ?? "สนาม";
  let totalAmount = Number(b.amount);
  if (b.group_id) {
    const { data: groupList } = await supabase
      .from("bookings")
      .select("starts_at, ends_at, amount, courts(name)")
      .eq("group_id", b.group_id)
      .order("court_id");
    if (groupList && groupList.length > 1) {
      const allSameSlot = groupList.every(
        (item) => item.starts_at === b.starts_at && item.ends_at === b.ends_at,
      );
      if (allSameSlot) {
        courtName = groupList
          .map((item) => (item.courts as { name?: string } | null)?.name ?? "สนาม")
          .join(", ");
      } else {
        courtName = groupList
          .map((item) => {
            const cname = (item.courts as { name?: string } | null)?.name ?? "สนาม";
            return `${cname} (${formatTime(item.starts_at)}–${formatTime(item.ends_at)})`;
          })
          .join(", ");
      }
      totalAmount = groupList.reduce((sum, item) => sum + Number(item.amount), 0);
    }
  }

  const { data: profile } = await supabase.from("profiles").select("display_name").eq("id", b.user_id).maybeSingle();
  return {
    court: courtName,
    startsAt: b.starts_at,
    endsAt: b.ends_at,
    amount: totalAmount,
    customer: b.customer_name ?? profile?.display_name ?? "ลูกค้า",
    channel: b.channel,
    userId: b.user_id,
  };
}

/** When a customer makes a new booking (pending payment hold). */
export async function notifyNewBooking(bookingId: string): Promise<void> {
  if (!enabled("new_booking")) return;
  const summary = await loadBookingSummary(bookingId);
  if (!summary) return;
  await notifyAdmins(newBookingAlertText(summary));
}

/** After a customer submits a slip: tell the shop it was confirmed, or that it needs a look, and update customer. */
export async function notifyAfterSlip(bookingId: string, verifyStatus: string | null): Promise<void> {
  if (verifyStatus === "skipped") return;
  const event: ShopEvent = verifyStatus === "verified" ? "confirmed" : "needs_review";
  if (!enabled(event)) return;
  const summary = await loadBookingSummary(bookingId);
  if (!summary) return;

  if (event === "confirmed") {
    await notifyAdmins(bookingConfirmedText(summary));
    await notifyCustomer(summary.userId, customerBookingConfirmedText(summary, bookingId));
    return;
  }

  const { data } = await getServiceClient()!
    .from("payments")
    .select("verify_reasons")
    .eq("booking_id", bookingId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  await notifyAdmins(slipNeedsReviewText(summary, (data?.verify_reasons as string[] | undefined) ?? []));
  await notifyCustomer(summary.userId, customerSlipSubmittedText(summary));
}

/** After an admin reviews a payment slip. */
export async function notifyPaymentReviewed(bookingId: string, approve: boolean, note: string): Promise<void> {
  const summary = await loadBookingSummary(bookingId);
  if (!summary) return;

  if (approve) {
    if (enabled("confirmed")) await notifyAdmins(bookingConfirmedText(summary));
    await notifyCustomer(summary.userId, customerBookingConfirmedText(summary, bookingId));
  } else {
    await notifyCustomer(summary.userId, customerSlipRejectedText(summary, note));
  }
}

/** After the shop phone reports money in. */
export async function notifyAfterTransfer(
  result: { outcome: string; booking_id?: string; reconciled?: boolean },
  amount: number | null,
): Promise<void> {
  if (result.outcome === "matched" && result.booking_id && !result.reconciled && enabled("confirmed")) {
    const summary = await loadBookingSummary(result.booking_id);
    if (summary) {
      await notifyAdmins(bookingConfirmedText(summary));
      await notifyCustomer(summary.userId, customerBookingConfirmedText(summary, result.booking_id));
    }
  } else if (result.outcome === "unmatched" && enabled("unmatched")) {
    await notifyAdmins(unmatchedTransferText(amount));
  }
}

/** A customer asked to move or cancel a paid booking. */
export async function notifyBookingRequest(bookingId: string, kind: "reschedule" | "cancel"): Promise<void> {
  if (!enabled("request")) return;
  const summary = await loadBookingSummary(bookingId);
  if (!summary) return;
  const title = kind === "cancel" ? "❌ ลูกค้ายกเลิกการจองแล้ว · รอโอนคืน" : "🙋 ขอเลื่อนการจอง";
  await notifyAdmins(`${title}\n${summary.court} · ${sanitizeName(summary.customer)}\nดูที่หน้าแอดมิน หัวข้อ "คำขอ"`);
}

/** After an admin resolves a reschedule or cancel request. */
export async function notifyRequestResolvedToCustomer(
  bookingId: string,
  kind: "reschedule" | "cancel",
  approve: boolean,
  note: string,
): Promise<void> {
  const summary = await loadBookingSummary(bookingId);
  if (!summary) return;
  await notifyCustomer(summary.userId, customerRequestResolvedText(summary, kind, approve, note));
}
