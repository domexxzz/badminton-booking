import "server-only";
import { getServiceClient } from "@/lib/supabase/service";
import {
  bookingConfirmedText,
  sanitizeName,
  slipNeedsReviewText,
  unmatchedTransferText,
  type BookingSummary,
  type ShopEvent,
} from "./messages";
import { multicastText } from "./messaging";

const DEFAULT_EVENTS = "confirmed,needs_review,unmatched,request";

function enabled(event: ShopEvent): boolean {
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

async function loadBookingSummary(bookingId: string): Promise<BookingSummary | null> {
  const supabase = getServiceClient();
  if (!supabase) return null;
  const { data: b } = await supabase
    .from("bookings")
    .select("starts_at, ends_at, amount, channel, customer_name, user_id, courts(name)")
    .eq("id", bookingId)
    .maybeSingle<{
      starts_at: string;
      ends_at: string;
      amount: number;
      channel: string;
      customer_name: string | null;
      user_id: string;
      courts: { name: string } | null;
    }>();
  if (!b) return null;
  const { data: profile } = await supabase.from("profiles").select("display_name").eq("id", b.user_id).maybeSingle();
  return {
    court: b.courts?.name ?? "สนาม",
    startsAt: b.starts_at,
    endsAt: b.ends_at,
    amount: Number(b.amount),
    customer: b.customer_name ?? profile?.display_name ?? "ลูกค้า",
    channel: b.channel,
  };
}

/** After a customer submits a slip: tell the shop it was confirmed, or that it needs a look. */
export async function notifyAfterSlip(bookingId: string, verifyStatus: string | null): Promise<void> {
  if (verifyStatus === "skipped") return;
  const event: ShopEvent = verifyStatus === "verified" ? "confirmed" : "needs_review";
  if (!enabled(event)) return;
  const summary = await loadBookingSummary(bookingId);
  if (!summary) return;

  if (event === "confirmed") return notifyAdmins(bookingConfirmedText(summary));
  const { data } = await getServiceClient()!
    .from("payments")
    .select("verify_reasons")
    .eq("booking_id", bookingId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return notifyAdmins(slipNeedsReviewText(summary, (data?.verify_reasons as string[] | undefined) ?? []));
}

/** After the shop phone reports money in. */
export async function notifyAfterTransfer(
  result: { outcome: string; booking_id?: string; reconciled?: boolean },
  amount: number | null,
): Promise<void> {
  if (result.outcome === "matched" && result.booking_id && !result.reconciled && enabled("confirmed")) {
    const summary = await loadBookingSummary(result.booking_id);
    if (summary) await notifyAdmins(bookingConfirmedText(summary));
  } else if (result.outcome === "unmatched" && enabled("unmatched")) {
    await notifyAdmins(unmatchedTransferText(amount));
  }
}

/** A customer asked to move or cancel a paid booking. */
export async function notifyBookingRequest(bookingId: string, kind: "reschedule" | "cancel"): Promise<void> {
  if (!enabled("request")) return;
  const summary = await loadBookingSummary(bookingId);
  if (!summary) return;
  const title = kind === "cancel" ? "🙋 ขอยกเลิก + คืนเงิน" : "🙋 ขอเลื่อนการจอง";
  await notifyAdmins(`${title}\n${summary.court} · ${sanitizeName(summary.customer)}\nดูที่หน้าแอดมิน หัวข้อ "คำขอ"`);
}
