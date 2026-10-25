import "server-only";
import { getServiceClient } from "@/lib/supabase/service";
import { buildCheckRecord, receiverFromEnv, type CheckRecord } from "./check-record";
import { verifyWithEasySlip } from "./easyslip";
import { pickSlipProvider } from "./provider";
import { verifyWithTyphoon } from "./typhoon";
import type { ProviderResult } from "./types";

type PendingPayment = {
  id: string;
  amount?: number;
  slip_path: string;
  bookings: { amount: number; created_at: string; status: string } | null;
};

export function isSlipVerificationEnabled(): boolean {
  return pickSlipProvider(process.env) !== null && getServiceClient() !== null;
}

function toRecord(result: ProviderResult, payment: PendingPayment): CheckRecord {
  const envReceiver = receiverFromEnv(process.env);
  const receiverNames =
    envReceiver.receiverNames.length > 0
      ? envReceiver.receiverNames
      : ["อัครเนย์", "akkanay", "อัครเนย์ ลาน้ำเที่ยง", "นาย อัครเนย์ ลาน้ำเที่ยง"];

  return buildCheckRecord(result, {
    amountBaht: Number(payment.amount ?? payment.bookings!.amount),
    bookingCreatedAt: payment.bookings!.created_at,
    now: new Date(),
    ...envReceiver,
    receiverNames,
  });
}

/**
 * Checks the latest submitted slip of a booking with EasySlip and records the
 * outcome. Only a clean "verified" result acts on its own (confirms the
 * booking); anything else stays with an admin, with the reasons attached.
 * Never throws: any failure leaves the booking for manual review.
 * Returns the recorded status, or null when nothing was checked.
 */
export async function verifyLatestSlip(bookingId: string): Promise<string | null> {
  const provider = pickSlipProvider(process.env);
  const supabase = getServiceClient();
  if (!provider || !supabase) return null;

  try {
    const { data: payment, error } = await supabase
      .from("payments")
      .select("id, amount, slip_path, bookings(amount, created_at, status)")
      .eq("booking_id", bookingId)
      .eq("status", "submitted")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<PendingPayment>();
    if (error) throw error;
    if (!payment?.bookings || payment.bookings.status !== "awaiting_review") return null;

    const { data: image, error: downloadError } = await supabase.storage.from("slips").download(payment.slip_path);
    let result: ProviderResult;
    if (downloadError) {
      console.error("Slip download failed:", downloadError);
      result = { kind: "error", message: "ดาวน์โหลดไฟล์สลิปไม่สำเร็จ" };
    } else if (provider === "easyslip") {
      result = await verifyWithEasySlip(image, process.env.EASYSLIP_API_KEY!);
    } else {
      result = await verifyWithTyphoon(image, process.env.TYPHOON_API_KEY!);
    }

    const check = toRecord(result, payment);

    // Call record_slip_check RPC:
    // If check.status == "verified", this updates payment status to 'approved'
    // and booking status to 'confirmed' automatically!
    const statusForRpc =
      check.status === "verified" || check.status === "mismatch" || check.status === "unreadable" || check.status === "error"
        ? check.status
        : "mismatch";

    const { data: recorded, error: recordError } = await supabase.rpc("record_slip_check", {
      p_payment_id: payment.id,
      p_status: statusForRpc,
      p_reasons: check.reasons,
      p_trans_ref: check.transRef ?? null,
      p_slip_amount: check.amount ?? null,
      p_slip_date: check.date ?? null,
      p_raw: check.raw ?? null,
    });
    if (recordError) throw recordError;
    return recorded as string;
  } catch (error) {
    console.error(`Slip verification failed for booking ${bookingId}:`, error);
    return null;
  }
}

