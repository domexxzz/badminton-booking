import "server-only";
import { formatTime } from "@/lib/format";
import type { BookingSummary } from "@/lib/line/messages";
import { getServiceClient } from "@/lib/supabase/service";
import { slotStart } from "@/lib/slots";
import { getTelegramConfig, sendTelegramMessage, sendTelegramPhoto, type TelegramSendOptions } from "./client";
import {
  formatTelegramDailySummary,
  summaryDays,
  type DailySummaryBooking,
  type DailySummaryKind,
} from "./daily-summary";
import {
  formatTelegramCancelledBooking,
  formatTelegramCancelRequest,
  formatTelegramNewBooking,
  formatTelegramRescheduleRequest,
  formatTelegramSlipReport,
  type TelegramBookingSummary,
} from "./messages";

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
    const config = getTelegramConfig();
    const text = formatTelegramNewBooking(summary, bookingId);

    const sendOptions: TelegramSendOptions = {
      parseMode: "HTML",
      chatId: summary.party ? config?.partyChatId : config?.chatId,
      messageThreadId: summary.party ? config?.partyThreadId : undefined,
    };

    await sendTelegramMessage(text, sendOptions);
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
    const config = getTelegramConfig();
    const sendOptions: TelegramSendOptions = {
      parseMode: "HTML",
      chatId: summary.party ? config?.partyChatId : config?.chatId,
      messageThreadId: summary.party ? config?.partyThreadId : undefined,
    };

    // Try to send as photo with report caption if slip image is available
    if (payment?.slip_path) {
      try {
        const { data: fileData, error: downloadError } = await supabase.storage
          .from("slips")
          .download(payment.slip_path);

        if (!downloadError && fileData) {
          const sent = await sendTelegramPhoto(fileData, text, sendOptions);
          if (sent) return;
        }
      } catch (photoErr) {
        console.error("Failed to send slip photo to Telegram, falling back to text:", photoErr);
      }
    }

    // Fallback: send as text message
    await sendTelegramMessage(text, sendOptions);
  } catch (error) {
    console.error("Telegram slip report notification failed:", error);
  }
}

/** Pushes a booking request (cancel/refund or reschedule) notification to Telegram. Never throws. */
export async function notifyTelegramBookingRequest(
  bookingId: string,
  kind: "reschedule" | "cancel",
): Promise<void> {
  try {
    const supabase = getServiceClient();
    if (!supabase) return;

    const summary = await loadBookingSummary(bookingId);
    if (!summary) return;

    const config = getTelegramConfig();
    const sendOptions: TelegramSendOptions = {
      parseMode: "HTML",
      chatId: summary.party ? config?.partyChatId : config?.chatId,
      messageThreadId: summary.party ? config?.partyThreadId : undefined,
    };

    const { data: req } = await supabase
      .from("booking_requests")
      .select("refund_amount, reason, refund_account, refund_qr_path, new_court_id, new_starts_at, new_ends_at, courts:new_court_id(name)")
      .eq("booking_id", bookingId)
      .eq("kind", kind)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (kind === "cancel") {
      const text = formatTelegramCancelRequest({
        summary,
        bookingId,
        refundAmount: req?.refund_amount != null ? Number(req.refund_amount) : summary.amount,
        reason: req?.reason,
        refundAccount: req?.refund_account,
      });

      // If customer attached a refund QR image, send it as photo with caption
      if (req?.refund_qr_path) {
        try {
          const { data: fileData, error: downloadError } = await supabase.storage
            .from("refunds")
            .download(req.refund_qr_path);

          if (!downloadError && fileData) {
            const sent = await sendTelegramPhoto(fileData, text, sendOptions);
            if (sent) return;
          }
        } catch (qrErr) {
          console.error("Failed to send refund QR photo to Telegram, falling back to text:", qrErr);
        }
      }

      await sendTelegramMessage(text, sendOptions);
      return;
    }

    if (kind === "reschedule") {
      const newCourtName = (req?.courts as { name?: string } | null)?.name ?? null;
      const text = formatTelegramRescheduleRequest({
        summary,
        bookingId,
        newCourtName,
        newStartsAt: req?.new_starts_at,
        newEndsAt: req?.new_ends_at,
        reason: req?.reason,
      });
      await sendTelegramMessage(text, sendOptions);
    }
  } catch (error) {
    console.error("Telegram booking request notification failed:", error);
  }
}

/** Pushes a direct booking cancellation alert to Telegram. Never throws. */
export async function notifyTelegramCancelledBooking(bookingId: string): Promise<void> {
  try {
    const summary = await loadBookingSummary(bookingId);
    if (!summary) return;

    const config = getTelegramConfig();
    const sendOptions: TelegramSendOptions = {
      parseMode: "HTML",
      chatId: summary.party ? config?.partyChatId : config?.chatId,
      messageThreadId: summary.party ? config?.partyThreadId : undefined,
    };

    const text = formatTelegramCancelledBooking(summary, bookingId);
    await sendTelegramMessage(text, sendOptions);
  } catch (error) {
    console.error("Telegram cancelled booking notification failed:", error);
  }
}

async function loadDayBookings(day: string): Promise<DailySummaryBooking[] | null> {
  const supabase = getServiceClient();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("bookings")
    .select("court_id, status, amount, starts_at, ends_at, user_id, customer_name, customer_phone")
    .gte("starts_at", slotStart(day, 0))
    .lt("starts_at", slotStart(day, 24))
    .returns<
      (DailySummaryBooking & { user_id: string; customer_name: string | null; customer_phone: string | null })[]
    >();
  if (error) {
    console.error(`Daily summary: loading bookings for ${day} failed:`, error);
    return null;
  }

  // Online bookings carry the customer's profile; phone/LINE/walk-in carry customer_name.
  const userIds = [...new Set(data.filter((b) => !b.customer_name).map((b) => b.user_id))];
  const { data: profiles } = userIds.length
    ? await supabase.from("profiles").select("id, display_name, phone").in("id", userIds)
    : { data: [] };
  const who = new Map((profiles ?? []).map((p) => [p.id, p]));

  return data.map(({ user_id, customer_name, customer_phone, ...b }) => {
    const profile = who.get(user_id);
    return {
      ...b,
      customer: {
        name: customer_name ?? profile?.display_name ?? null,
        phone: customer_phone ?? profile?.phone ?? null,
      },
    };
  });
}

/** Sends the morning or closing daily summary to the shop's Telegram group. Returns whether it was sent. */
export async function sendTelegramDailySummary(kind: DailySummaryKind, now: Date = new Date()): Promise<boolean> {
  try {
    const supabase = getServiceClient();
    if (!supabase) return false;
    const { day, nextDay } = summaryDays(kind, now);

    const [courts, bookings, nextDayBookings, awaitingReview, requests] = await Promise.all([
      supabase.from("courts").select("id, name").eq("is_active", true).order("id"),
      loadDayBookings(day),
      nextDay ? loadDayBookings(nextDay) : Promise.resolve(null),
      supabase.from("bookings").select("id", { count: "exact", head: true }).eq("status", "awaiting_review"),
      supabase.from("booking_requests").select("kind").eq("status", "pending"),
    ]);
    if (courts.error || !bookings || awaitingReview.error || requests.error || (nextDay && !nextDayBookings)) {
      console.error("Daily summary: loading data failed:", courts.error ?? awaitingReview.error ?? requests.error);
      return false;
    }

    const text = formatTelegramDailySummary({
      kind,
      day,
      courts: courts.data,
      bookings,
      pending: {
        awaitingReview: awaitingReview.count ?? 0,
        cancelRequests: requests.data.filter((r) => r.kind === "cancel").length,
        rescheduleRequests: requests.data.filter((r) => r.kind === "reschedule").length,
      },
      nextDay: nextDay && nextDayBookings ? { day: nextDay, bookings: nextDayBookings } : undefined,
    });
    return await sendTelegramMessage(text, { parseMode: "HTML" });
  } catch (error) {
    console.error("Telegram daily summary failed:", error);
    return false;
  }
}
