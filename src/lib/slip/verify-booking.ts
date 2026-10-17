import "server-only";
import { getServiceClient } from "@/lib/supabase/service";
import { verifyWithEasySlip } from "./easyslip";
import { evaluateSlip } from "./evaluate";
import type { ProviderResult, VerifyStatus } from "./types";

type PendingPayment = {
  id: string;
  amount?: number;
  slip_path: string;
  bookings: { amount: number; created_at: string; status: string } | null;
};

type CheckRecord = {
  status: VerifyStatus;
  reasons: string[];
  transRef?: string;
  amount?: number;
  date?: string;
  raw?: unknown;
};

export function isSlipVerificationEnabled(): boolean {
  return Boolean(process.env.EASYSLIP_API_KEY) && getServiceClient() !== null;
}

function toRecord(result: ProviderResult, payment: PendingPayment): CheckRecord {
  if (result.kind !== "ok") {
    return { status: result.kind, reasons: [result.message] };
  }
  const evaluation = evaluateSlip(result.slip, {
    amountBaht: Number(payment.amount ?? payment.bookings!.amount),
    bookingCreatedAt: payment.bookings!.created_at,
    now: new Date(),
    promptPayId: process.env.PROMPTPAY_ID || null,
    bankAccount: process.env.SLIP_RECEIVER_BANK_ACCOUNT || null,
    receiverNames: (process.env.SLIP_RECEIVER_NAME ?? "")
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean),
  });
  return {
    status: evaluation.status,
    reasons: evaluation.reasons,
    transRef: result.slip.transRef,
    amount: result.slip.amount,
    date: result.slip.date,
    raw: result.raw,
  };
}

/**
 * Checks the latest submitted slip of a booking with EasySlip and records the
 * outcome. Only a clean "verified" result acts on its own (confirms the
 * booking); anything else stays with an admin, with the reasons attached.
 * Never throws: any failure leaves the booking for manual review.
 * Returns the recorded status, or null when nothing was checked.
 */
export async function verifyLatestSlip(bookingId: string): Promise<string | null> {
  const apiKey = process.env.EASYSLIP_API_KEY;
  const supabase = getServiceClient();
  if (!apiKey || !supabase) return null;

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
    const result: ProviderResult = downloadError
      ? { kind: "error", message: "ดาวน์โหลดไฟล์สลิปไม่สำเร็จ" }
      : await verifyWithEasySlip(image, apiKey);
    if (downloadError) console.error("Slip download failed:", downloadError);

    const check = toRecord(result, payment);
    const { data: recorded, error: recordError } = await supabase.rpc("record_slip_check", {
      p_payment_id: payment.id,
      p_status: check.status,
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
