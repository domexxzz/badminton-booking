import "server-only";
import { formatTime } from "@/lib/format";
import type { BookingSummary } from "@/lib/line/messages";
import { getServiceClient } from "@/lib/supabase/service";
import { sendTelegramMessage, sendTelegramPhoto } from "./client";
import { formatTelegramNewBooking, formatTelegramSlipReport, type TelegramBookingSummary } from "./messages";

async function loadBookingSummary(bookingId: string): Promise<TelegramBookingSummary | null> {
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
  let multiCourtCount: number | undefined = undefined;

  if (b.group_id) {
    const { data: groupList } = await supabase
      .from("bookings")
      .select("starts_at, ends_at, amount, courts(name)")
      .eq("group_id", b.group_id)
      .order("court_id");
    if (groupList && groupList.length > 1) {
      multiCourtCount = groupList.length;
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

  // Check if booking is linked to a party/team room
  const { data: party } = await supabase
    .from("party_rooms")
    .select("id, title, mode, host_name")
    .eq("booking_id", bookingId)
    .maybeSingle();

  return {
    court: courtName,
    startsAt: b.starts_at,
    endsAt: b.ends_at,
    amount: totalAmount,
    customer: b.customer_name ?? profile?.display_name ?? "ลูกค้า",
    channel: b.channel,
    userId: b.user_id,
    party: party ? { id: party.id, title: party.title, mode: party.mode, hostName: party.host_name } : null,
    multiCourtCount,
  };
}

/** Pushes a new booking notification to the shop's Telegram group. Never throws. */
export async function notifyTelegramNewBooking(bookingId: string): Promise<void> {
  try {
    const summary = await loadBookingSummary(bookingId);
    if (!summary) return;
    const text = formatTelegramNewBooking(summary, bookingId);
    await sendTelegramMessage(text, { parseMode: "HTML" });
  } catch (error) {
    console.error("Telegram new booking notification failed:", error);
  }
}

/** Pushes an EasySlip verification report (with slip photo) to Telegram group. Never throws. */
export async function notifyTelegramAfterSlip(
  bookingId: string,
  verifyStatus: string | null,
): Promise<void> {
  if (verifyStatus === "skipped") return;
  try {
    const supabase = getServiceClient();
    if (!supabase) return;

    const summary = await loadBookingSummary(bookingId);
    if (!summary) return;

    const { data: payment } = await supabase
      .from("payments")
      .select("id, amount, slip_path, verify_status, verify_reasons, slip_amount, slip_date, trans_ref, verify_raw")
      .eq("booking_id", bookingId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Extract sender name and bank from EasySlip raw response if present
    let senderName: string | null = null;
    let senderBank: string | null = null;
    if (payment?.verify_raw && typeof payment.verify_raw === "object") {
      const raw = payment.verify_raw as Record<string, any>;
      const sender = raw?.data?.sender;
      senderName = sender?.name?.th || sender?.name?.en || sender?.account?.name?.th || null;
      senderBank = sender?.bank?.name || sender?.bank?.short || null;
    }

    const reportParams = {
      summary,
      bookingId,
      verifyStatus: payment?.verify_status ?? verifyStatus,
      reasons: (payment?.verify_reasons as string[] | undefined) ?? [],
      slipAmount: payment?.slip_amount,
      slipDate: payment?.slip_date,
      transRef: payment?.trans_ref,
      senderName,
      senderBank,
    };

    const text = formatTelegramSlipReport(reportParams);

    // Try to send as photo with report caption if slip image is available
    if (payment?.slip_path) {
      try {
        const { data: fileData, error: downloadError } = await supabase.storage
          .from("slips")
          .download(payment.slip_path);

        if (!downloadError && fileData) {
          const sent = await sendTelegramPhoto(fileData, text, { parseMode: "HTML" });
          if (sent) return;
        }
      } catch (photoErr) {
        console.error("Failed to send slip photo to Telegram, falling back to text:", photoErr);
      }
    }

    // Fallback: send as text message
    await sendTelegramMessage(text, { parseMode: "HTML" });
  } catch (error) {
    console.error("Telegram slip report notification failed:", error);
  }
}
